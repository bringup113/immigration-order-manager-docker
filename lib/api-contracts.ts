export type OrderDetailTab = "workflow" | "finance" | "people" | "common";

export type OrderListRow = {
  id: string;
  order_no: string;
  status: string;
  owner_user_id: string;
  owner_name: string;
  owner_username: string;
  created_at: string;
  signed_at: string | null;
  agent_name: string;
  project_name: string;
  country: string;
  main_applicant: string | null;
  current_step: string | null;
  current_step_status: string | null;
  current_step_due_date: string | null;
  in_progress_steps: number | string;
  completed_steps: number | string;
  total_steps: number | string;
  pending_follow_up: string | null;
  pending_follow_up_date: string | null;
  receivable_base_minor?: number | string;
  payable_base_minor?: number | string;
  received_base_minor?: number | string;
  paid_base_minor?: number | string;
};

export type OrderListOwner = {
  id: string;
  name: string;
  username: string;
};

export type PageResponse<T> = {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  owners: OrderListOwner[];
};

export type GlobalSearchGroup = "orders" | "projects" | "agents";

export type GlobalSearchPage = {
  page: number;
  pageSize: number;
  hasMore: boolean;
  loaded: boolean;
};

export type GlobalSearchOrder = {
  order_no: string;
  agent_name: string;
  project_name: string;
  main_applicant: string | null;
  match_summary?: string;
  target_tab?: OrderDetailTab;
};

export type GlobalSearchProject = {
  id: string;
  code: string;
  name: string;
  country: string;
};

export type GlobalSearchAgent = {
  id: string;
  name: string;
  contact_name: string | null;
  phone: string | null;
};

export type GlobalSearchResponse = {
  indexing?: boolean;
  terms?: string[];
  orders: GlobalSearchOrder[];
  projects: GlobalSearchProject[];
  agents: GlobalSearchAgent[];
  pagination: Record<GlobalSearchGroup, GlobalSearchPage>;
};
