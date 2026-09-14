export type DatabaseRow = Record<string, unknown>;

export type DatabaseRunResult = {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number | bigint;
  };
};

export interface AppPreparedStatement {
  bind(...values: unknown[]): AppPreparedStatement;
  all<T = DatabaseRow>(): Promise<{ results: T[]; success: boolean }>;
  first<T = DatabaseRow>(): Promise<T | null>;
  run(): Promise<DatabaseRunResult>;
}

export interface AppDatabase {
  readonly dialect: "postgres";
  prepare(sql: string): AppPreparedStatement;
  batch(statements: AppPreparedStatement[]): Promise<DatabaseRunResult[]>;
  transaction<T>(callback: (database: AppDatabase) => Promise<T>): Promise<T>;
}
