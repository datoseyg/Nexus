export interface LoginActionState {
  error: string | null;
}

export const INITIAL_LOGIN_STATE: LoginActionState = {
  error: null,
};

export interface LogoutActionState {
  error: string | null;
}

export const INITIAL_LOGOUT_STATE: LogoutActionState = {
  error: null,
};