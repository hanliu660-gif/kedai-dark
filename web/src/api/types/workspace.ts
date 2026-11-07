// API 类型 · 工作区画像（自 api/types.ts 按域搬移，声明原样、不改线格式）。

/** 工作区画像的一条命中(CODE-4;`services/workspace_profile.rs` 的同名结构体) */
export interface ProjectTypeHint {
  /** 类型标识(rust / node / python / go / java / dotnet;未知取值原样展示,不假装认识) */
  kind: string;
  /** 证据文件的相对路径(根层即文件名,子目录层形如 `server-rs/Cargo.toml`) */
  marker: string;
  /** 建议的验证命令(后端常量表文案,**不是**实测结论) */
  suggested_command: string;
  /** 命中层级:0 = 工作区根,1 = 直接子目录 */
  depth: number;
}

/**
 * 工作区画像(CODE-4):任务绑定工作区后展示「这是什么项目 + 建议怎么验证」。
 * 详情顶层 `workspace_profile` 与 `GET /api/workspace/profile` 是同一个函数的两处出口;
 * 未绑定工作区 → 详情里为 `null`(前端不渲染该行)。
 */
export interface WorkspaceProfile {
  /** 被探测的工作区根(冻结值原样回显,Windows 上可能含 `\\?\` 前缀) */
  root: string;
  /** 命中项,按后端常量表顺序(rust → node → python → go → java → dotnet) */
  detected: ProjectTypeHint[];
  /** 实际扫描的子目录数(不含根;根恒扫一次) */
  scanned_dirs: number;
  /** 是否因子目录数超上限而未扫全(诚实留痕,不假装扫完) */
  truncated: boolean;
}
