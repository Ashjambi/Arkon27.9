import React from 'react';

interface TabProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: string;
}

export const SettingsTab: React.FC<TabProps> = ({ active, onClick, label, icon }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-4 px-5 py-4 rounded-2xl text-xs font-black transition-all w-full ${
      active ? 'bg-white text-black' : 'text-zinc-500 hover:bg-white/5'
    }`}
  >
    <i className={`fas fa-${icon} w-5`}></i>
    {label}
  </button>
);

export const SettingsSection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-10 animate-in slide-in-from-left duration-300">
    <h2 className="text-3xl font-black text-white italic">{title}</h2>
    {children}
  </div>
);

export const InputField: React.FC<{
  label: string;
  value: string | number;
  onChange: (val: any) => void;
  type?: 'text' | 'number' | 'checkbox';
  placeholder?: string;
}> = ({ label, value, onChange, type = 'text', placeholder }) => (
  <div className="space-y-3">
    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{label}</label>
    {type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-6 h-6 bg-zinc-900 border border-zinc-800 rounded-md"
      />
    ) : (
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) : e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-6 py-4 text-white font-mono"
        placeholder={placeholder}
      />
    )}
  </div>
);
