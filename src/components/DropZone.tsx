import React, { useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';

interface DropZoneProps {
  onFileSelect: (filePath: string) => void;
}

export const DropZone: React.FC<DropZoneProps> = ({ onFileSelect }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
      const filePath = window.electronAPI.getFilePath(files[0]);
      console.log('DropZone: File dropped. Path:', filePath);
      onFileSelect(filePath);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const filePath = window.electronAPI.getFilePath(files[0]);
      console.log('DropZone: File selected via input. Path:', filePath);
      onFileSelect(filePath);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      className={`
        w-full max-w-xl h-64 
        border-2 border-dashed rounded-2xl 
        flex flex-col items-center justify-center 
        cursor-pointer transition-all duration-200
        ${isDragOver 
          ? 'border-indigo-500 bg-indigo-500/10' 
          : 'border-zinc-700 hover:border-indigo-500/50 hover:bg-zinc-800/50 bg-zinc-900/50'
        }
      `}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInput}
        accept=".pdf"
        className="hidden"
      />
      
      <div className={`
        w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-transform duration-200
        ${isDragOver ? 'scale-110 bg-indigo-500/20' : 'bg-zinc-800'}
      `}>
        {isDragOver ? (
          <Upload className="w-8 h-8 text-indigo-400" />
        ) : (
          <FileText className="w-8 h-8 text-zinc-400 group-hover:text-indigo-400" />
        )}
      </div>
      
      <h3 className="text-xl font-medium text-white mb-2">
        {isDragOver ? 'Drop PDF here' : 'Select PDF File'}
      </h3>
      <p className="text-sm text-zinc-500">
        Drag and drop or click to browse
      </p>
    </div>
  );
};
