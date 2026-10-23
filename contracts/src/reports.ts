/** Reports of content that breaks the rules or harms someone, reviewed by platform administrators. */
export const REPORT_REASONS = ['privacy', 'harassment', 'false_information', 'copyright', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  privacy: 'Shares private information about me or someone else',
  harassment: 'Harassment, hate or threats',
  false_information: 'Deliberately false or misleading',
  copyright: 'Copyright or someone else’s material',
  inappropriate: 'Offensive or inappropriate content',
  other: 'Something else',
};

export const REPORT_TARGETS = ['family', 'member', 'media', 'story', 'event'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

export const REPORT_STATUSES = ['open', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface CreateReportRequest {
  familyId: string;
  targetType: ReportTarget;
  /** Not needed when reporting the family itself. */
  targetId?: string;
  reason: ReportReason;
  details: string;
}

export interface ReportView {
  id: string;
  family: { id: string; name: string; status: string } | null;
  targetType: ReportTarget;
  targetId: string | null;
  /** What was reported, as it was named when the report was made. */
  targetLabel: string;
  reason: ReportReason;
  details: string;
  reporter: { id: string; displayName: string; email: string } | null;
  status: ReportStatus;
  resolution: string;
  actions: string[];
  createdAt: string;
  resolvedAt: string | null;
}

export interface ResolveReportRequest {
  status: 'resolved' | 'dismissed';
  /** Shared with the reporter. */
  resolution: string;
  /** Tell the family's administrators about the report, and/or suspend the family. */
  notifyFamilyAdmins?: boolean;
  suspendFamily?: boolean;
}
