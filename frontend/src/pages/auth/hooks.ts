import { useMutation } from '@tanstack/react-query';
import {
  acceptInvite,
  fetchCurrentUser,
  login,
  logout,
  signup,
  validateInvitation,
  verifyMfa,
  type AcceptInviteParams,
  type SignupParams,
} from './api';

export function useLogin() {
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
  });
}

export function useVerifyMfa() {
  return useMutation({
    mutationFn: ({ mfaToken, code }: { mfaToken: string; code: string }) => verifyMfa(mfaToken, code),
  });
}

export function useLogoutMutation() {
  return useMutation({ mutationFn: logout });
}

export function useFetchCurrentUser() {
  return useMutation({ mutationFn: fetchCurrentUser });
}

export function useSignup() {
  return useMutation({ mutationFn: (params: SignupParams) => signup(params) });
}

export function useValidateInvitation() {
  return useMutation({ mutationFn: (token: string) => validateInvitation(token) });
}

export function useAcceptInvite() {
  return useMutation({ mutationFn: (params: AcceptInviteParams) => acceptInvite(params) });
}
