/// <reference types="vite/client" />

interface Window {
  electronAPI: {
    getFilePath: (file: File) => string;
    saveApiKey: (key: string) => Promise<boolean>;
    getApiKey: () => Promise<string | null>;
    readFileBuffer: (path: string) => Promise<Uint8Array>;
    saveMarkdownFile: (content: string) => Promise<boolean>;
  };
}
