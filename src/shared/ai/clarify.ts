// 结构化提问与补丁预览类型

/** 结构化提问卡片。 */
export interface IClarifyQuestion {
  id: string;
  text: string;
  type: 'text' | 'choice' | 'confirm';
  options?: string[];
  dependsOn?: string;
  condition?: string;
}

/** 结构化提问会话状态。 */
export interface IClarifySession {
  questions: IClarifyQuestion[];
  answers: Record<string, string>;
  phase: 'asking' | 'answered' | 'expired';
}

/** 补丁预览单文件。 */
export interface IPatchFile {
  filePath: string;
  oldContent: string;
  newContent: string;
}

/** 补丁预览。 */
export interface IPatchPreview {
  files: IPatchFile[];
  status: 'pending' | 'applied' | 'discarded' | 'rolled_back';
  contentHash?: string;
}
