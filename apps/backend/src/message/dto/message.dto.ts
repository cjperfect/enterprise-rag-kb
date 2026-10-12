export interface EditMessageDto {
  /** 新内容 */
  content: string;
}

export interface SwitchBranchDto {
  /** 目标消息 entry id（pi entry id，字符串） */
  entryId: string;
}
