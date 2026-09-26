// Rules for names, emails and passwords, shared by the sign-up form (live hints)
// and the server (which enforces them).

export const ACCOUNT_LIMITS = {
  nameMax: 80,
  workspaceNameMin: 2,
  workspaceNameMax: 80,
  emailMax: 254,
  passwordMin: 10,
  passwordMax: 200,
} as const

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Deliberately simple: something@something.tld, no spaces, at most 254 characters. */
export function emailProblem(email: string): string | null {
  if (!email) return 'Enter your email address'
  if (email.length > ACCOUNT_LIMITS.emailMax) return 'That email address is too long'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return 'Enter a valid email address, like you@company.com'
  return null
}

export function nameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter your name'
  if (trimmed.length > ACCOUNT_LIMITS.nameMax) return `Names can be at most ${ACCOUNT_LIMITS.nameMax} characters`
  return null
}

export function workspaceNameProblem(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length < ACCOUNT_LIMITS.workspaceNameMin) return 'Give your workspace a name, like your team or company'
  if (trimmed.length > ACCOUNT_LIMITS.workspaceNameMax) return `Workspace names can be at most ${ACCOUNT_LIMITS.workspaceNameMax} characters`
  return null
}

// The most common leaked passwords of 10+ characters (lowercase). A short list
// catches the worst choices without shipping a large dictionary to the browser.
const COMMON = new Set([
  '1234567890', '0123456789', '1234512345', '1111111111', '0000000000', '1122334455', '9876543210', 'qwertyuiop',
  'qwerty1234', 'qwerty12345', 'password12', 'password123', 'password1234', 'passw0rd123', 'iloveyou12', 'abcdefghij',
  'abcd123456', 'a123456789', '123456789a', 'asdfghjkl1', 'asdfghjkla', '1q2w3e4r5t', '1qaz2wsx3edc', 'zaq12wsxcde',
  'welcome123', 'welcome1234', 'letmein123', 'admin12345', 'administrator', 'changeme123', 'football123', 'baseball123',
  'sunshine123', 'princess123', 'dragon1234', 'monkey1234', 'superman123', 'trustno1234', 'qwertyuiop1', 'india12345',
  'india@1234', 'flowpilot123', 'flowpilot-demo', 'password@123', 'pass@12345', 'test123456', 'testing123',
])

/** Null when acceptable; otherwise what to change. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < ACCOUNT_LIMITS.passwordMin) return `Use at least ${ACCOUNT_LIMITS.passwordMin} characters`
  if (password.length > ACCOUNT_LIMITS.passwordMax) return `Use at most ${ACCOUNT_LIMITS.passwordMax} characters`
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return 'That password is too common; choose something less guessable'
  if (new Set(lower).size <= 2) return 'Use more than one or two different characters'
  const local = context.email?.split('@')[0]?.toLowerCase()
  if (local && local.length >= 4 && lower.includes(local)) return "Don't include your email address in your password"
  return null
}

/** 0–4 for the strength meter: length and variety, after the hard rules above. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < ACCOUNT_LIMITS.passwordMin) return 0
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length
  let score = 1
  if (password.length >= 12) score++
  if (password.length >= 16) score++
  if (kinds >= 3) score++
  return Math.min(score, 4) as 0 | 1 | 2 | 3 | 4
}
