import ExcelJS from 'exceljs';

export async function exportXlsx(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName: string,
  widths?: number[],
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);
  const headers = Object.keys(rows[0] || {});
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: header,
    width: widths?.[index] || Math.min(Math.max(header.length + 2, 12), 32),
  }));
  worksheet.addRows(rows);

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
