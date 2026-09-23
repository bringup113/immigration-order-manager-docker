import type { OrderDetailTab } from "@/lib/api-contracts";

export type ReminderType =
  | "RECEIPT"
  | "PAYMENT"
  | "STEP"
  | "FOLLOW_UP"
  | "MATERIAL"
  | "TASK";

export type Dashboard = {
  activeOrders: number;
  receivableMinor: number;
  payableMinor: number;
  balanceMinor: number;
  reminders: {
    source: string;
    reminder_type: ReminderType;
    target_tab: OrderDetailTab;
    due_date: string;
    order_no: string;
    title: string;
    project_name: string;
    main_applicant: string | null;
  }[];
  reminderCounts?: { todayKey: string; overdue: number; today: number; week: number };
  trend: { month: string; income_minor: number; expense_minor: number }[];
  access: {
    orders: boolean;
    finance: boolean;
    materials: boolean;
    tasks: boolean;
    ordersWrite: boolean;
  };
};
