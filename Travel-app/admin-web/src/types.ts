export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  errorCode?: number;
  [key: string]: unknown | T;
}

export interface AdminProfile {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'VIEWER';
}

export interface LoginResult {
  token: string;
  expiresIn: number;
  admin: AdminProfile;
}

export interface MetricSummary {
  taskCreatedCount: number;
  taskRebuiltCount: number;
  taskCanceledCount: number;
  distinctCreatedUserCount: number;
  dueTaskCount: number;
  triggeredTaskCount: number;
  missedTaskCount: number;
  sendSuccessCount: number;
  sendFailureCount: number;
  sendSkippedCount: number;
  dueHandlingRate: number | null;
  sendSuccessRate: number | null;
}

export interface SpotStat extends MetricSummary {
  spotId: string;
  spotName: string;
  shortName: string;
}

export interface TrendPoint extends MetricSummary {
  dateKey: string;
}

export interface OverviewResult {
  range: { startDate: string; endDate: string };
  userTotal: number;
  newUserCount: number;
  metrics: MetricSummary;
  topSpots: SpotStat[];
  trend: TrendPoint[];
  dataTruncated: boolean;
}

export interface UserListItem {
  id: string;
  userIdMasked: string;
  nicknameMasked: string;
  avatarUrl: string;
  phoneMasked: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  tripCount: number;
  itemCount: number;
  taskCounts: Record<string, number>;
  subscribeQuota: number;
}

export interface UserListResult {
  page: number;
  pageSize: number;
  total: number;
  items: UserListItem[];
}

export interface UserDetailResult {
  user: UserListItem & {
    memberLevel: string;
    points: number;
  };
  trips: Record<string, unknown>[];
  items: Record<string, unknown>[];
  taskCounts: Record<string, number>;
  tasks: Record<string, unknown>[];
}

export interface TaskListItem {
  id: string;
  userIdMasked: string;
  userLabel: string;
  spotId: string;
  spotName: string;
  visitDate: string | null;
  releaseAt: string | null;
  offsets: number[];
  sentOffsets: number[];
  channels: string[];
  backendStatus: string;
  triggeredAt: string | null;
  missedReason: string | null;
  lastSendError: string | null;
  createdAt: string | null;
}

export interface TaskListResult {
  page: number;
  pageSize: number;
  total: number;
  items: TaskListItem[];
}

export interface TaskDetailResult {
  task: TaskListItem & Record<string, unknown>;
  item: Record<string, unknown> | null;
  events: Record<string, unknown>[];
}

export interface SpotsStatsResult {
  range: { startDate: string; endDate: string };
  summary: MetricSummary;
  items: SpotStat[];
  trend: TrendPoint[];
  dataTruncated: boolean;
}
