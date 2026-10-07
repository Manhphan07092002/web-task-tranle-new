import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { X, User as UserIcon, Mail, Shield, Briefcase, Phone, Calendar, MapPin, Info, CreditCard, Users } from 'lucide-react';
import { Button } from './UI';
import { useData } from '../contexts/DataContext';
import Flatpickr from 'react-flatpickr';
import { toLocalDateString } from '../utils/dateUtils';
import 'flatpickr/dist/themes/light.css';

interface UserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (user: User) => void;
  initialUser?: User | null;
}

export const UserModal: React.FC<UserModalProps> = ({ isOpen, onClose, onSave, initialUser }) => {
  const { roles, departments } = useData();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  
  const defaultRole = roles.length > 0 ? roles[0].name : 'Employee';
  const defaultDepartment = departments[0]?.name || '';

  const [role, setRole] = useState<UserRole>(defaultRole);
  const [department, setDepartment] = useState(defaultDepartment);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [hometown, setHometown] = useState('');
  const [cccd, setCccd] = useState('');
  const [gender, setGender] = useState('');
  const [bio, setBio] = useState('');
  const [joinDate, setJoinDate] = useState('');

  useEffect(() => {
    if (isOpen) {
      if (initialUser) {
        setName(initialUser.name);
        setEmail(initialUser.email);
        setRole(initialUser.role);
        setDepartment(initialUser.department);
        setAvatarUrl(initialUser.avatar);
        setPhone(initialUser.phone || '');
        setDob(initialUser.dob || '');
        setHometown(initialUser.hometown || '');
        setCccd(initialUser.cccd || '');
        setGender(initialUser.gender || '');
        setBio(initialUser.bio || '');
        setJoinDate(initialUser.joinDate || '');
      } else {
        setName('');
        setEmail('');
        setRole(roles.length > 0 ? roles[0].name : 'Employee');
        setDepartment(departments[0]?.name || '');
        setAvatarUrl(`https://picsum.photos/id/${Math.floor(Math.random() * 100)}/50/50`);
        setPhone('');
        setDob('');
        setHometown('');
        setCccd('');
        setGender('');
        setBio('');
        setJoinDate('');
      }
    }
  }, [isOpen, initialUser, roles, departments]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user: User = {
      id: initialUser ? initialUser.id : Math.random().toString(36).substr(2, 9),
      name,
      email,
      role,
      department,
      avatar: avatarUrl || 'https://via.placeholder.com/50',
      phone,
      dob,
      hometown,
      cccd,
      gender,
      bio,
      joinDate
    };
    onSave(user);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-6 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-800">
            {initialUser ? 'Edit User' : 'Add Team Member'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="overflow-y-auto p-6 flex-1 custom-scrollbar">
          <form id="user-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                    placeholder="John Doe"
                  />
                </div>
              </div>

              <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                 <div className="relative">
                   <Mail className="absolute left-3 top-2.5 text-gray-400" size={18} />
                   <input 
                     type="email" 
                     required
                     value={email}
                     onChange={(e) => setEmail(e.target.value)}
                     className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                     placeholder="john@company.com"
                   />
                 </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <div className="relative">
                   <Shield className="absolute left-3 top-2.5 text-gray-400" size={18} />
                   <select 
                     value={role}
                     onChange={(e) => setRole(e.target.value as UserRole)}
                     className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none bg-white"
                   >
                     {roles.length > 0 ? (
                       roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)
                     ) : (
                       <><option value="Admin">Admin</option>
                       <option value="Director">Director</option>
                       <option value="Manager">Manager</option>
                       <option value="Employee">Employee</option></>
                     )}
                   </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Department</label>
                <div className="relative">
                   <Briefcase className="absolute left-3 top-2.5 text-gray-400" size={18} />
                   <select 
                     value={department}
                     onChange={(e) => setDepartment(e.target.value)}
                     className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none bg-white"
                   >
                     <option value="">-- Chưa chọn phòng ban --</option>
                     {initialUser?.department && !departments.some(d => d.name === initialUser.department) && (
                       <option value={initialUser.department}>{initialUser.department}</option>
                     )}
                     {departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                   </select>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 my-4 pt-4">
              <h4 className="text-sm font-semibold text-gray-600 mb-3 uppercase tracking-wider">Personal Information</h4>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-2.5 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                      placeholder="e.g. 0987654321"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-2.5 text-gray-400" size={18} />
                    <input 
                      type="date" 
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hometown</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-2.5 text-gray-400" size={18} />
                    <input 
                      type="text" 
                      value={hometown}
                      onChange={(e) => setHometown(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                      placeholder="e.g. Hanoi, Vietnam"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Ngày tham gia</label>
                  <Flatpickr
                    value={joinDate ? new Date(joinDate) : ''}
                    onChange={([date]) => setJoinDate(date ? toLocalDateString(date) : '')}
                    options={{ dateFormat: 'd/m/Y' }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-400 outline-none text-sm transition-shadow bg-gray-50"
                    placeholder="Chọn ngày"
                  />
                </div>
              </div>

              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Giới tính</label>
                  <div className="relative">
                    <Users className="absolute left-3 top-2.5 text-gray-400" size={18} />
                    <select 
                      value={gender}
                      onChange={(e) => setGender(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none bg-white"
                    >
                      <option value="">Chọn giới tính</option>
                      <option value="Nam">Nam</option>
                      <option value="Nữ">Nữ</option>
                      <option value="Khác">Khác</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">CCCD / ID Card</label>
                <div className="relative">
                  <CreditCard className="absolute left-3 top-2.5 text-gray-400" size={18} />
                  <input 
                    type="text" 
                    value={cccd}
                    onChange={(e) => setCccd(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none"
                    placeholder="Nhập số CCCD"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bio (About)</label>
                <div className="relative">
                  <Info className="absolute left-3 top-3 text-gray-400" size={18} />
                  <textarea 
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-400 outline-none min-h-[80px]"
                    placeholder="Brief introduction about this person..."
                  />
                </div>
              </div>
            </div>
          </form>
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-gray-100 flex-shrink-0 bg-gray-50">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="user-form" variant="primary">{initialUser ? 'Save Changes' : 'Add Member'}</Button>
        </div>
      </div>
    </div>
  );
};
