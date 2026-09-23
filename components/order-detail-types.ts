import type { CashDirection, Row } from "@/components/order-detail-ui";
import type { CurrencyOption } from "@/components/currency-select";
import type { CashCalculatedField } from "@/lib/cash-calculation";
import type { PassportIdentity, PassportMrzCapture } from "@/lib/passport-mrz";

export type MaterialDraft = {
  applicantId: string;
  name: string;
  required: boolean;
  expectedDate: string;
  notes: string;
};

export type ApplicantDraft = PassportIdentity & { relationship: string };

export type MrzReview = {
  applicantId: string;
  materialFileId: string;
  capture: PassportMrzCapture;
  fields: PassportIdentity;
};

export type ProgressDraft = {
  title: string;
  progressDate: string;
  details: string;
  nextAction: string;
  followUpDate: string;
  pinned: boolean;
};

export type StepDraft = {
  name: string;
  dueDate: string;
  required: boolean;
  notes: string;
};

export type TaskDraft = {
  title: string;
  dueDate: string;
  priority: string;
  ownerUserId: string;
  relatedType: string;
  relatedId: string;
};

export type PlanDraft = {
  planType: string;
  name: string;
  currency: string;
  amount: string;
  dueDate: string;
  notes: string;
};

export type CashDraft = {
  autoDescription?: string | null;
  direction: CashDirection;
  entryDate: string;
  description: string;
  currency: string;
  amount: string;
  baseAmount: string;
  ratePerUsd: string;
  calculatedField: CashCalculatedField;
  orderPlanId: string;
  notes: string;
};

export type ClosureDraft = {
  closedOn: string;
  result: string;
  notes: string;
  reason: string;
};

export type OrderDetailData = {
  historyHasMore: boolean;
  cashHasMore: boolean;
  order: Row;
  applicants: Row[];
  mrzRecords: Row[];
  steps: Row[];
  plans: Row[];
  materials: Row[];
  materialFiles: Row[];
  progress: Row[];
  cashEntries: Row[];
  tasks: Row[];
  assignableUsers: Row[];
  closureCheck: Row;
  closureHistory: Row[];
  receivedBaseMinor: number;
  paidBaseMinor: number;
  balanceBaseMinor: number;
  availableCurrencies?: CurrencyOption[];
};

export type OrderDetailDialog =
  | "progress"
  | "plan"
  | "step"
  | "material"
  | "cash"
  | "applicant"
  | "mrz"
  | "task"
  | "close"
  | null;

export type OrderDetailConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  destructive?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  onConfirm: (reason: string) => Promise<void>;
};
