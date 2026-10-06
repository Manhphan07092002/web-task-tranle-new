import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { z } from 'zod';
import { GoogleGenAI, Type } from '@google/genai';
import { TRANLE_KNOWLEDGE } from '../tranle_knowledge.js';
import { requireAdmin } from '../middleware/auth.js';
import { decrypt } from '../utils/cryptoUtils.js';
import { validate } from '../middleware/validate.js';

const AiKeyTestSchema = z.object({
  provider: z.enum(['gemini', 'groq', 'deepseek', 'openrouter', 'openai']),
  apiKey: z.string().min(8).max(2048),
});
const AiTaskTitleSchema = z.object({ taskTitle: z.string().trim().min(1).max(1000) });
const AiGoalSchema = z.object({ goal: z.string().trim().min(1).max(8000) });
const AiChatSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  history: z.array(z.object({ role: z.enum(['user', 'model']), text: z.string().max(8000) }).strict()).max(50).optional().default([]),
  contextString: z.string().max(20_000).optional().default(''),
});

// ─── Key Rotation State (per-process, shared across requests) ─────────────────
let _cachedProvider: string | null = null;
let _cachedKeys: string[] = [];
let _currentKeyIndex = 0;
let _cacheExpiry = 0;
const KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface KeyStatus {
  status: 'Active' | 'Rate Limited' | 'Quota Exceeded' | 'Invalid' | 'Unknown';
  lastChecked: number;
}
export const _keyStatuses: Record<string, KeyStatus> = {};
const keyFingerprint = (apiKey: string) => crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12);
const parseStoredKeys = (value?: string) => {
  if (!value) return [];
  const plaintext = decrypt(value) || value;
  try {
    const parsed = JSON.parse(plaintext);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

async function getAiConfig(db: any): Promise<{ provider: string; keys: string[] }> {
  const now = Date.now();
  if (_cachedProvider && _cachedKeys.length > 0 && now < _cacheExpiry) {
    return { provider: _cachedProvider, keys: _cachedKeys };
  }
  try {
    const providers = ['gemini', 'groq', 'deepseek', 'openrouter', 'openai'];
    const keysMap: Record<string, string[]> = {};
    for (const p of providers) {
      const row = await db.get('SELECT `value` FROM system_config WHERE `key` = ?', [`${p}_api_keys`]);
      keysMap[p] = parseStoredKeys(row?.value);
    }
    const providerRow = await db.get("SELECT `value` FROM system_config WHERE `key` = 'ai_provider'");
    const provider = providerRow?.value || 'gemini';
    const keys = (keysMap[provider] || []).filter((k: string) => k.trim().length > 0);
    _cachedProvider = provider;
    _cachedKeys = keys;
    _currentKeyIndex = 0;
    _cacheExpiry = now + KEY_CACHE_TTL;
    return { provider, keys };
  } catch {
    return { provider: 'gemini', keys: [] };
  }
}

export function invalidateAiKeyCache() {
  _cacheExpiry = 0;
}

const getOpenAIProviderConfig = (provider: string) => {
  switch (provider) {
    case 'groq':       return { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' };
    case 'deepseek':   return { url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-chat' };
    case 'openrouter': return { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'google/gemini-2.5-flash:free' };
    case 'openai':     return { url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o' };
    default:           return { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile' };
  }
};

const parseJSON = (text: string) => {
  try { return JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()); }
  catch { return null; }
};

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function withRotation<T>(db: any, operation: (apiKey: string, provider: string) => Promise<T>): Promise<T> {
  const { provider, keys } = await getAiConfig(db);
  if (keys.length === 0) throw new Error('No AI API keys configured');
  
  const MAX_RETRIES_PER_KEY = 2;
  let keyAttempts = 0;
  
  while (keyAttempts < keys.length) {
    const apiKey = keys[_currentKeyIndex % keys.length];
    
    for (let retry = 0; retry <= MAX_RETRIES_PER_KEY; retry++) {
      try {
        const result = await operation(apiKey, provider);
        _keyStatuses[keyFingerprint(apiKey)] = { status: 'Active', lastChecked: Date.now() };
        return result;
      } catch (err: any) {
        const msg = String(err?.message || '');
        const status = err?.status;
        
        let errStatus: KeyStatus['status'] = 'Unknown';
        if (status === 401 || msg.includes('API_KEY_INVALID')) {
          errStatus = 'Invalid';
        } else if ((status === 429 && msg.toLowerCase().includes('quota')) || msg.toLowerCase().includes('exceeded')) {
          errStatus = 'Quota Exceeded';
        } else if (status === 429 || status === 503 || msg.includes('429') || msg.includes('503')) {
          errStatus = 'Rate Limited';
        } else {
          errStatus = 'Unknown';
        }
        _keyStatuses[keyFingerprint(apiKey)] = { status: errStatus, lastChecked: Date.now() };

        const isRateLimit = errStatus === 'Rate Limited' || errStatus === 'Quota Exceeded';
          
        if (isRateLimit || errStatus === 'Invalid') {
          if (errStatus === 'Rate Limited' && retry < MAX_RETRIES_PER_KEY) {
            console.warn(`[AI Route] Rate limit/503 on key index ${_currentKeyIndex}. Retrying in ${1000 * (retry + 1)}ms...`);
            await delay(1000 * (retry + 1));
            continue;
          } else if (keys.length > 1) {
            _currentKeyIndex = (_currentKeyIndex + 1) % keys.length;
            console.warn(`[AI Route] Exhausted retries or key invalid/quota. Rotating to key index ${_currentKeyIndex}...`);
            keyAttempts++;
            break; // Break inner loop to try next key
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
  }
  throw new Error('All AI API keys exhausted or rate limited.');
}

const BOT_SYSTEM_INSTRUCTION = `Bạn là "Bot Tran Le AI", trợ lý AI đắc lực, tinh tế và vô cùng thông minh, được phát triển nội bộ cho hệ thống quản lý công việc và năng lượng của Công ty Cổ phần Tư vấn xây dựng Điện Trần Lê (Tran Le Electricity).
Bạn giao tiếp bằng Tiếng Việt với phong thái chuyên nghiệp, nhiệt tình, luôn đưa ra giải pháp (Solution-oriented) thay vì chỉ báo cáo.

QUY TẮC HOẠT ĐỘNG CỐT LÕI (TUYỆT ĐỐI TUÂN THỦ):
1. BẢO MẬT ID HỆ THỐNG: Mọi thông tin ngữ cảnh bạn nhận được có thể chứa các mã [ID: uuid]. TUYỆT ĐỐI KHÔNG BAO GIỜ hiển thị các mã ID này ra màn hình cho người dùng. Chỉ gọi tên/tiêu đề khi nói chuyện. Mã ID CHỈ dùng để điền vào param khi gọi Tools (ví dụ: deleteTask).
2. TƯ DUY RÕ RÀNG (Chain-of-Thought): 
   - Không được "tự biên tự diễn" (Hallucination) các thông tin không có thực.
   - Khi người dùng yêu cầu tạo mới (Task, Meeting, Report...) nhưng cung cấp THIẾU thông tin thiết yếu, bạn PHẢI CHỦ ĐỘNG HỎI LẠI để làm rõ (Ví dụ: "Bạn muốn tạo lịch họp với ai và vào lúc nào?") thay vì gọi Tool một cách bừa bãi hoặc tự điền giá trị ngẫu nhiên.
3. CHỦ ĐỘNG TÓM TẮT THÔNG MINH: Nếu người dùng chào buổi sáng hoặc hỏi tình hình công việc, hãy tổng hợp các Task đang QUÁ HẠN (nếu có), các Task chưa hoàn thành, các thông báo chưa đọc và lịch họp trong ngày để giúp họ nắm bắt nhanh.
4. GỌI TOOL THAY VÌ NÓI SUÔNG: Khi nhận được lệnh rõ ràng (tạo, xóa, sửa, chuyển trang), HÃY GỌI TOOLS tương ứng ngay lập tức. Đừng chỉ mô tả lại cách làm bằng chữ.
5. ĐỊNH DẠNG TIN NHẮN: Luôn trình bày trực quan bằng Markdown (bullet points, in đậm từ khóa quan trọng) để tối ưu trải nghiệm đọc.
6. THỜI GIAN THỰC: Luôn tham khảo thời gian thực (Giờ/Ngày) được cung cấp trong ngữ cảnh để phản hồi mang tính thời sự (Ví dụ: "Hiện tại đã 16:00, bạn nhớ nộp báo cáo nhé!").

Hãy mang lại năng lượng tích cực và sự hiệu quả tối đa cho mọi nhân sự của Tran Le Electricity!

=============================================
DƯỚI ĐÂY LÀ KIẾN THỨC NỘI BỘ VỀ CÔNG TY TRAN LE ELECTRICITY MÀ BẠN CẦN NẮM ĐỂ TRẢ LỜI CÁC CÂU HỎI VÀ TƯ VẤN:
${TRANLE_KNOWLEDGE}
=============================================`;

const OPENAI_TOOLS = [
  { type: 'function', function: { name: 'createTask', description: 'Tạo một công việc (Task) mới. CHỈ GỌI khi đã có đủ thông tin Tiêu đề.', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string', enum: ['Low', 'Medium', 'High'] }, dueDate: { type: 'string', description: 'Định dạng ISO 8601' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'createReport', description: 'Tạo một báo cáo (Report) mới cho công ty. Cần Tiêu đề và Nội dung cụ thể.', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title', 'content'] } } },
  { type: 'function', function: { name: 'createContract', description: 'Tạo một hợp đồng (Contract) mới. Yêu cầu Số hợp đồng, Tên đối tác và Tên hợp đồng.', parameters: { type: 'object', properties: { contractNumber: { type: 'string' }, clientName: { type: 'string' }, contractName: { type: 'string' } }, required: ['contractNumber', 'clientName', 'contractName'] } } },
  { type: 'function', function: { name: 'deleteTask', description: 'Xóa một công việc (Task). Yêu cầu mã ID của task.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'createNote', description: 'Tạo một ghi chú (Note) cá nhân mới.', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'deleteNote', description: 'Xóa một ghi chú (Note). Yêu cầu mã ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'createMeeting', description: 'Tạo một lịch họp (Meeting) mới. CHỈ GỌI khi người dùng đã chốt Tiêu đề và Thời gian.', parameters: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, participantNames: { type: 'array', items: { type: 'string' } }, startTime: { type: 'string', description: 'Định dạng ISO 8601' } }, required: ['title', 'startTime'] } } },
  { type: 'function', function: { name: 'deleteMeeting', description: 'Xóa một lịch họp (Meeting). Yêu cầu mã ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'markNotificationRead', description: 'Đánh dấu một thông báo là đã đọc. Yêu cầu mã ID.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } } },
  { type: 'function', function: { name: 'navigateToPage', description: 'Mở hoặc chuyển hướng đến một trang (Ví dụ: /tasks, /meetings, /reports, /settings).', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'sendEmail', description: 'Gửi email cho một người. Yêu cầu địa chỉ email người nhận (to), chủ đề (subject) và nội dung (body).', parameters: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject', 'body'] } } },
  { type: 'function', function: { name: 'updateTaskStatus', description: 'Cập nhật trạng thái của một công việc (Ví dụ: từ Todo sang In Progress hoặc Done).', parameters: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['Todo', 'In Progress', 'Done'] } }, required: ['id', 'status'] } } },
];

const GEMINI_TOOL_DECLARATIONS: any[] = [
  { name: 'createTask', description: 'Tạo một công việc (Task) mới. CHỈ GỌI khi đã có đủ thông tin Tiêu đề.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, description: { type: Type.STRING }, priority: { type: Type.STRING, enum: ['Low', 'Medium', 'High'] }, dueDate: { type: Type.STRING, description: 'Định dạng ISO 8601' } }, required: ['title'] } },
  { name: 'createReport', description: 'Tạo một báo cáo (Report) mới cho công ty. Cần Tiêu đề và Nội dung cụ thể.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, content: { type: Type.STRING } }, required: ['title', 'content'] } },
  { name: 'createContract', description: 'Tạo một hợp đồng (Contract) mới. Yêu cầu Số hợp đồng, Tên đối tác và Tên hợp đồng.', parameters: { type: Type.OBJECT, properties: { contractNumber: { type: Type.STRING }, clientName: { type: Type.STRING }, contractName: { type: Type.STRING } }, required: ['contractNumber', 'clientName', 'contractName'] } },
  { name: 'deleteTask', description: 'Xóa một công việc (Task). Yêu cầu mã ID của task.', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ['id'] } },
  { name: 'createNote', description: 'Tạo một ghi chú (Note) cá nhân mới.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, content: { type: Type.STRING } }, required: ['title'] } },
  { name: 'deleteNote', description: 'Xóa một ghi chú (Note). Yêu cầu mã ID.', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ['id'] } },
  { name: 'createMeeting', description: 'Tạo một lịch họp (Meeting) mới. CHỈ GỌI khi người dùng đã chốt Tiêu đề và Thời gian.', parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, description: { type: Type.STRING }, participantNames: { type: Type.ARRAY, items: { type: Type.STRING } }, startTime: { type: Type.STRING, description: 'Định dạng ISO 8601' } }, required: ['title', 'startTime'] } },
  { name: 'deleteMeeting', description: 'Xóa một lịch họp (Meeting). Yêu cầu mã ID.', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ['id'] } },
  { name: 'markNotificationRead', description: 'Đánh dấu một thông báo là đã đọc. Yêu cầu mã ID.', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING } }, required: ['id'] } },
  { name: 'navigateToPage', description: 'Mở hoặc chuyển hướng đến một trang (Ví dụ: /tasks, /meetings, /reports, /settings).', parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING } }, required: ['path'] } },
  { name: 'sendEmail', description: 'Gửi email cho một người. Yêu cầu địa chỉ email người nhận (to), chủ đề (subject) và nội dung (body).', parameters: { type: Type.OBJECT, properties: { to: { type: Type.STRING }, subject: { type: Type.STRING }, body: { type: Type.STRING } }, required: ['to', 'subject', 'body'] } },
  { name: 'updateTaskStatus', description: 'Cập nhật trạng thái của một công việc (Ví dụ: từ Todo sang In Progress hoặc Done).', parameters: { type: Type.OBJECT, properties: { id: { type: Type.STRING }, status: { type: Type.STRING, enum: ['Todo', 'In Progress', 'Done'] } }, required: ['id', 'status'] } },
];

export function aiRoutes(db: any) {
  const router = Router();
  const allowedProviders = new Set(['gemini', 'groq', 'deepseek', 'openrouter', 'openai']);
  router.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many AI requests. Please try again later.' },
  }));

  // GET /api/ai/status - check if AI is configured
  router.get('/status', async (_req, res) => {
    try {
      const { provider, keys } = await getAiConfig(db);
      res.json({ configured: keys.length > 0, provider, keyCount: keys.length });
    } catch {
      res.json({ configured: false, provider: 'gemini', keyCount: 0 });
    }
  });

  // POST /api/ai/test-key - test a specific API key
  router.post('/test-key', requireAdmin, validate(AiKeyTestSchema), async (req, res) => {
    const { provider, apiKey } = req.body;
    if (typeof provider !== 'string' || !allowedProviders.has(provider) || typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 2048) {
      return res.status(400).json({ error: 'Valid provider and apiKey are required' });
    }
    
    try {
      if (provider === 'gemini') {
        const ai = new GoogleGenAI({ apiKey });
        await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: 'say hi',
          config: { maxOutputTokens: 1 }
        });
      } else {
        const { url, model } = getOpenAIProviderConfig(provider);
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://tranlecorp.com', 'X-Title': 'Tran Le Electricity' },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 })
        });
        if (!r.ok) {
           const err = await r.json().catch(() => ({})) as any;
           const error = new Error(`API Error: ${r.status} ${err.error?.message || ''}`) as any;
           error.status = r.status;
           throw error;
        }
      }
      _keyStatuses[keyFingerprint(apiKey)] = { status: 'Active', lastChecked: Date.now() };
      res.json({ status: 'Active' });
    } catch (err: any) {
      const msg = String(err?.message || '');
      const status = err?.status;
      let errStatus: KeyStatus['status'] = 'Unknown';
      if (status === 401 || msg.includes('API_KEY_INVALID')) {
        errStatus = 'Invalid';
      } else if ((status === 429 && msg.toLowerCase().includes('quota')) || msg.toLowerCase().includes('exceeded')) {
        errStatus = 'Quota Exceeded';
      } else if (status === 429 || status === 503 || msg.includes('429') || msg.includes('503')) {
        errStatus = 'Rate Limited';
      } else {
        errStatus = 'Unknown';
      }
      _keyStatuses[keyFingerprint(apiKey)] = { status: errStatus, lastChecked: Date.now() };
      res.json({ status: errStatus, error: msg });
    }
  });

  // GET /api/ai/keys-status - return current status of all keys
  router.get('/keys-status', requireAdmin, async (_req, res) => {
    try {
      const { provider, keys } = await getAiConfig(db);
      const result: Record<string, KeyStatus> = {};
      for (const k of keys) {
        const fingerprint = keyFingerprint(k);
        result[fingerprint] = _keyStatuses[fingerprint] || { status: 'Unknown', lastChecked: 0 };
      }
      res.json({ provider, statuses: result });
    } catch {
      res.json({ provider: 'gemini', statuses: {} });
    }
  });

  // POST /api/ai/generate-subtasks
  router.post('/generate-subtasks', validate(AiTaskTitleSchema), async (req, res) => {
    const { taskTitle } = req.body;
    if (!taskTitle) return res.status(400).json({ error: 'taskTitle is required' });
    try {
      const result = await withRotation(db, async (apiKey, provider) => {
        if (provider === 'gemini') {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a list of 3 to 5 concise, actionable subtasks (checklist items) for a task titled: "${taskTitle}". Return ONLY the list of strings in a JSON array.`,
            config: { responseMimeType: 'application/json', responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } } }
          });
          return parseJSON(response.text || '[]') || [];
        } else {
          const { url, model } = getOpenAIProviderConfig(provider);
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://tranlecorp.com', 'X-Title': 'Tran Le Electricity' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: `Generate a JSON array of 3-5 subtask strings for task: "${taskTitle}". Return ONLY the JSON array.` }] }) });
          const data = await r.json() as any;
          const parsed = parseJSON(data.choices?.[0]?.message?.content || '[]');
          return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.subtasks) ? parsed.subtasks : []);
        }
      });
      res.json({ subtasks: Array.isArray(result) ? result : [] });
    } catch (e: any) { console.error('[AI /generate-subtasks]', e); res.status(500).json({ error: e.message || 'AI generation failed' }); }
  });

  // POST /api/ai/generate-details
  router.post('/generate-details', validate(AiTaskTitleSchema), async (req, res) => {
    const { taskTitle } = req.body;
    if (!taskTitle) return res.status(400).json({ error: 'taskTitle is required' });
    try {
      const result = await withRotation(db, async (apiKey, provider) => {
        if (provider === 'gemini') {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `For a task titled "${taskTitle}", generate a concise 1-sentence description and a list of 3-5 actionable subtasks.`,
            config: { responseMimeType: 'application/json', responseSchema: { type: Type.OBJECT, properties: { description: { type: Type.STRING }, subtasks: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ['description', 'subtasks'] } }
          });
          return parseJSON(response.text || 'null');
        } else {
          const { url, model } = getOpenAIProviderConfig(provider);
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://tranlecorp.com', 'X-Title': 'Tran Le Electricity' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: `For task "${taskTitle}", return JSON with "description" (string) and "subtasks" (array of strings). Return ONLY JSON.` }] }) });
          const data = await r.json() as any;
          return parseJSON(data.choices?.[0]?.message?.content || 'null');
        }
      });
      res.json(result || { description: '', subtasks: [] });
    } catch (e: any) { console.error('[AI /generate-details]', e); res.status(500).json({ error: e.message || 'AI generation failed' }); }
  });

  // POST /api/ai/generate-tasks-from-goal
  router.post('/generate-tasks-from-goal', validate(AiGoalSchema), async (req, res) => {
    const { goal } = req.body;
    if (!goal) return res.status(400).json({ error: 'goal is required' });
    try {
      const result = await withRotation(db, async (apiKey, provider) => {
        if (provider === 'gemini') {
          const ai = new GoogleGenAI({ apiKey });
          const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `I have a goal: "${goal}". Break this down into 3 to 6 distinct, actionable tasks. For each task, provide a title, a short description, and a priority level (High, Medium, or Low).`,
            config: { responseMimeType: 'application/json', responseSchema: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, description: { type: Type.STRING }, priority: { type: Type.STRING, enum: ['High', 'Medium', 'Low'] } }, required: ['title', 'description', 'priority'] } } }
          });
          return parseJSON(response.text || '[]') || [];
        } else {
          const { url, model } = getOpenAIProviderConfig(provider);
          const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://tranlecorp.com', 'X-Title': 'Tran Le Electricity' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: `Goal: "${goal}". Return JSON array of 3-6 tasks, each with title, description, priority (High/Medium/Low). Return ONLY the JSON array.` }] }) });
          const data = await r.json() as any;
          const parsed = parseJSON(data.choices?.[0]?.message?.content || '[]');
          return Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.tasks) ? parsed.tasks : []);
        }
      });
      res.json({ tasks: Array.isArray(result) ? result : [] });
    } catch (e: any) { console.error('[AI /generate-tasks-from-goal]', e); res.status(500).json({ error: e.message || 'AI generation failed' }); }
  });

  // POST /api/ai/chat-stream  (Server-Sent Events)
  // Chunks: data: {"type":"text","content":"..."}\n\n
  //         data: {"type":"function_call","name":"...","args":{...}}\n\n
  //         data: {"type":"done"}\n\n
  router.post('/chat-stream', validate(AiChatSchema), async (req, res) => {
    const { message, history = [], contextString = '' } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const systemInstruction = contextString
      ? `${BOT_SYSTEM_INSTRUCTION}\n\n${contextString}`
      : BOT_SYSTEM_INSTRUCTION;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (obj: object) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const { keys } = await getAiConfig(db);
      if (keys.length === 0) {
        send({ type: 'error', content: 'AI chưa được cấu hình. Vui lòng Admin vào Cấu hình Hệ thống để thêm API Key.' });
        send({ type: 'done' });
        return res.end();
      }

      await withRotation(db, async (apiKey, provider) => {
        if (provider !== 'gemini') {
          const { url, model } = getOpenAIProviderConfig(provider);
          const messages: any[] = [
            { role: 'system', content: systemInstruction },
            ...(history as any[]).map((m: any) => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
            { role: 'user', content: message }
          ];
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': 'https://tranlecorp.com', 'X-Title': 'Tran Le Electricity' },
            body: JSON.stringify({ model, messages, tools: OPENAI_TOOLS, tool_choice: 'auto' })
          });
          if (!r.ok) {
            const err = await r.json().catch(() => ({})) as any;
            const error = new Error(`API Error: ${r.status} ${err.error?.message || ''}`) as any;
            error.status = r.status;
            throw error; // Let withRotation handle it
          }
          const data = await r.json() as any;
          const choice = data.choices?.[0];
          const text = choice?.message?.content || '';
          if (text) {
            const words = text.split(' ');
            for (let i = 0; i < words.length; i++) {
              send({ type: 'text', content: words[i] + (i < words.length - 1 ? ' ' : '') });
            }
          }
          if (choice?.message?.tool_calls) {
            for (const tc of choice.message.tool_calls) {
              send({ type: 'function_call', name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') });
            }
          }
        } else {
          // Gemini streaming
          const ai = new GoogleGenAI({ apiKey });
          const chat = ai.chats.create({
            model: 'gemini-2.5-flash',
            history: (history as any[]).map((m: any) => ({ role: m.role, parts: [{ text: m.text }] })),
            config: { systemInstruction, tools: [{ functionDeclarations: GEMINI_TOOL_DECLARATIONS }] }
          });
          const stream = await chat.sendMessageStream({ message });
          for await (const chunk of stream) {
            const parts = chunk.candidates?.[0]?.content?.parts;
            if (!parts) continue;
            for (const part of parts) {
              if (part.text) send({ type: 'text', content: part.text });
              if (part.functionCall) send({ type: 'function_call', name: part.functionCall.name, args: part.functionCall.args || {} });
            }
          }
        }
      });
      
      send({ type: 'done' });
      res.end();
    } catch (e: any) {
      console.error('[AI /chat-stream]', e);
      send({ type: 'error', content: e.message || 'AI error' });
      send({ type: 'done' });
      res.end();
    }
  });

  return router;
}

