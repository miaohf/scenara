export interface User {
  id: number;
  email: string;
  username: string;
}

export interface Project {
  id: string;
  title: string;
  character_library: unknown[];
  scene_library: unknown[];
  prop_library: unknown[];
  created_at: string;
  updated_at: string;
}

export interface Episode {
  id: string;
  project_id: string;
  series_id: string;
  user_id: number;
  episode_number: number;
  title: string;
  stage: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ApiError {
  detail?: string | { msg: string }[];
}
