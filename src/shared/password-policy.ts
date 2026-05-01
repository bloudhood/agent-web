export interface PasswordStrengthResult {
  valid: boolean;
  message: string;
}

export function validatePasswordStrength(password: string | undefined): PasswordStrengthResult {
  if (!password || password.length < 8) {
    return { valid: false, message: '密码长度至少 8 位' };
  }

  let types = 0;
  if (/[a-z]/.test(password)) types += 1;
  if (/[A-Z]/.test(password)) types += 1;
  if (/[0-9]/.test(password)) types += 1;
  if (/[^a-zA-Z0-9]/.test(password)) types += 1;

  if (types < 2) {
    return { valid: false, message: '密码需包含至少 2 种字符类型' };
  }

  return { valid: true, message: '' };
}
