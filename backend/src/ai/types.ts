export type AiAuthUser = {
  id: string;
  role: 'admin' | 'operator';
};

export type ToolContext = {
  user: AiAuthUser;
  memberId: string | null;
};

export type ChatMessage = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type DailyObservationRow = {
  plate: string | null;
  classification: string;
  confidence: number;
  noParking: boolean;
  waypointName: string;
  occurredAt: string;
  deviceName: string;
  taskId: string;
  observationCount: number;
};

export type DailyReportStats = {
  reportDate: string;
  patrolTaskCount: number;
  observationCount: number;
  violationCount: number;
  intrusionCount: number;
  illegalParkingCount: number;
  pendingReviewCount: number;
  intrusionPlates: string[];
  illegalParkingPlates: string[];
  pendingReviewPlates: string[];
};

export type DailyReportResult = {
  reportId: string;
  reportDate: string;
  vehicleId: string | null;
  narrativeMarkdown: string;
  stats: DailyReportStats;
  highlights: string[];
  source: 'ai' | 'template';
};
