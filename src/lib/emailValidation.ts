/**
 * Email Authenticity & Validation Module
 *
 * Enforces strict email verification and authenticity rules:
 * 1. Standard RFC 5322 syntax and structure.
 * 2. Valid domain structure and real Top-Level Domain (TLD).
 * 3. Blocking of disposable, temporary, burner, and throwaway email providers.
 * 4. Blocking of example, test, and placeholder domains.
 * 5. Detection of random gibberish, keyboard mashing, and dummy names in local parts.
 */

// ── 1. Known Disposable / Temporary / Burner Domains ──────────────────────────
export const DISPOSABLE_EMAIL_DOMAINS = new Set<string>([
  // Mailinator family
  'mailinator.com',
  'mailinator2.com',
  'mailin8r.com',
  'mailinator.net',
  'suremail.info',
  'reconmail.com',

  // TempMail family
  'tempmail.com',
  'tempmail.net',
  'temp-mail.org',
  'temp-mail.io',
  'tempmailaddress.com',
  'temp-mails.com',
  'tempemail.net',
  'mytempemail.com',

  // 10MinuteMail family
  '10minutemail.com',
  '10minutemail.net',
  '10minmail.com',
  '10minutemail.be',
  '10minutemail.co.uk',

  // Guerrilla Mail family & aliases
  'guerrillamail.com',
  'guerrillamailblock.com',
  'guerrillamail.net',
  'guerrillamail.biz',
  'guerrillamail.org',
  'guerrillamail.de',
  'guerrillamail.info',
  'sharklasers.com',
  'grr.la',
  'spam4.me',
  'pokemail.net',

  // Yopmail & aliases
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'yopmail.be',
  'yopmail.info',
  'cool.fr.nf',
  'jetable.fr.nf',
  'courriel.fr.nf',
  'nospam.ze.tc',

  // Trashmail family
  'trashmail.com',
  'trashmail.net',
  'trashmail.me',
  'trashmail.org',
  'trashmail.at',
  'trashmail.io',
  'trash-mail.com',
  'mytrashmail.com',

  // ThrowAway Mail
  'throwawaymail.com',
  'throwaway.email',
  'throwawayemailaddresses.com',

  // Dispostable & Maildrop
  'dispostable.com',
  'maildrop.cc',
  'inboxkitten.com',

  // Nada & GetNada
  'nada.ltd',
  'getnada.com',
  'getnada.cc',

  // Burner & Dropmail
  'burnermail.io',
  'dropmail.me',
  'mohmal.com',
  'mohmal.in',
  'mytemp.email',
  'generator.email',
  'fakeinbox.com',
  'crazymailing.com',
  'discard.email',
  'discardmail.com',
  'spambog.com',
  'mintemail.com',
  'spamgourmet.com',
  'emailondeck.com',
  'zillamail.com',
  'anonymbox.com',
  'bugmenot.com',
  'mailcatch.com',
  'binkmail.com',
  'safetymail.info',
  'tempail.com',
  'mailnesia.com',
  'tempinbox.com',
  '0147.org',
  'mailforspam.com',
  'spamevader.com',
  'moakt.cc',
  'moakt.co',
  'moakt.ws',
  'mailpoof.com',
  'tmail.ws',
  'fakemailgenerator.com',
  'emailfake.com',
  'inboxbear.com',
  'getairmail.com',
  'airmail.news',
  'disposablemail.com',
  'instant-mail.de',
  'spamfree24.org',
  'kasmail.com',
  'meltmail.com',
  'whyspam.me',
  'harakirimail.com',
  'mailnull.com',
  'mailscrap.com',

  // Fake Name Generator throwaway domains
  'armyspy.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fambest.com',
  'fleexy.com',
  'gustr.com',
  'jourrapide.com',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
])

// ── 2. Test, Example, and Placeholder Domains ────────────────────────────────
export const TEST_OR_PLACEHOLDER_DOMAINS = new Set<string>([
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'test.com',
  'testing.com',
  'test.org',
  'test.net',
  'test.co',
  'fake.com',
  'fakemail.com',
  'fakedata.com',
  'fakeaddress.com',
  'sample.com',
  'dummy.com',
  'placeholder.com',
  'asdf.com',
  'qwerty.com',
  'temp.com',
  'foo.com',
  'bar.com',
  'xyz.com',
  'none.com',
  'noemail.com',
  'nomail.com',
  'invalid.com',
  'invalid.org',
  'localhost',
  'localdomain',
])

// ── 3. Obvious Dummy / Placeholder Local Parts ──────────────────────────────
export const DUMMY_LOCAL_PARTS = new Set<string>([
  'test',
  'testing',
  'dummy',
  'fake',
  'fakeuser',
  'sample',
  'random',
  'randomuser',
  'nobody',
  'temp',
  'tempuser',
  'asdf',
  'asdfg',
  'asdfgh',
  'asdfghjkl',
  'qwerty',
  'qwertyuiop',
  'zxcvbnm',
  'admin',
  'administrator',
  'null',
  'undefined',
  'noemail',
  'anon',
  'anonymous',
])

export type EmailValidationResult = {
  isValid: boolean
  error: string | null
  domain?: string
  isDisposable?: boolean
  isTestDomain?: boolean
  isSuspiciousLocal?: boolean
}

/**
 * Validates local part for obvious random keyboard mashing or repetition.
 */
export function checkSuspiciousLocalPart(localPart: string): { isSuspicious: boolean; reason?: string } {
  const lower = localPart.toLowerCase().trim()

  // 1. Exact match against known dummy placeholder names
  if (DUMMY_LOCAL_PARTS.has(lower)) {
    return {
      isSuspicious: true,
      reason: 'Please enter your authentic name or identifier instead of a placeholder.',
    }
  }

  // 2. Minimum length check (local part must have at least 2 characters)
  if (lower.length < 2) {
    return {
      isSuspicious: true,
      reason: 'Email username is too short to be authentic.',
    }
  }

  // 3. Repeated identical characters (e.g. "aaaaa", "11111", "zzzzzz")
  if (/(.)\1{4,}/.test(lower)) {
    return {
      isSuspicious: true,
      reason: 'Email address appears to contain repetitive random characters.',
    }
  }

  // 4. Pure keyboard walks
  const keyboardWalks = [
    'asdfgh',
    'qwerty',
    'zxcvbn',
    '123456',
    '654321',
    'poiuyt',
    'lkjhgf',
  ]
  for (const walk of keyboardWalks) {
    if (lower.includes(walk) && lower.length <= walk.length + 3) {
      return {
        isSuspicious: true,
        reason: 'Email address appears to be a random keyboard sequence.',
      }
    }
  }

  // 5. No vowels in long alphabetic local-part (7+ characters with zero vowels)
  // Strips numbers and symbols first to analyze the letters
  const lettersOnly = lower.replace(/[^a-z]/g, '')
  if (lettersOnly.length >= 7 && !/[aeiouy]/.test(lettersOnly)) {
    return {
      isSuspicious: true,
      reason: 'Email address appears to be randomly generated (no vowels detected).',
    }
  }

  // 6. Suspicious dot patterns (consecutive dots, leading or trailing dots)
  if (lower.includes('..') || lower.startsWith('.') || lower.endsWith('.')) {
    return {
      isSuspicious: true,
      reason: 'Email username cannot start, end, or contain consecutive periods.',
    }
  }

  return { isSuspicious: false }
}

/**
 * Validates whether an email address is authentic.
 *
 * @param email - The email to inspect
 * @param options - `isSignUp: true` enables strict blocking of disposable/dummy emails
 */
export function validateAuthenticEmail(
  email: string,
  options: { isSignUp?: boolean } = { isSignUp: true }
): EmailValidationResult {
  const clean = email.trim()

  if (!clean) {
    return { isValid: false, error: 'Email address is required.' }
  }

  // Standard email format regex check
  const basicRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!basicRegex.test(clean)) {
    return { isValid: false, error: 'Please enter a valid email address (e.g., name@gmail.com).' }
  }

  const atIndex = clean.lastIndexOf('@')
  if (atIndex === -1 || atIndex === 0 || atIndex === clean.length - 1) {
    return { isValid: false, error: 'Please enter a valid email address.' }
  }

  const localPart = clean.slice(0, atIndex)
  const domainPart = clean.slice(atIndex + 1).toLowerCase()

  // Domain structure checks
  if (domainPart.includes('..') || domainPart.startsWith('.') || domainPart.endsWith('.')) {
    return { isValid: false, error: 'Domain name cannot contain consecutive or trailing periods.' }
  }

  const domainLabels = domainPart.split('.')
  if (domainLabels.length < 2) {
    return { isValid: false, error: 'Please include a valid domain extension (e.g., .com, .org).' }
  }

  const tld = domainLabels[domainLabels.length - 1]
  // TLD must be alphabetic and at least 2 characters
  if (!/^[a-z]{2,24}$/.test(tld)) {
    return { isValid: false, error: 'Domain extension must be valid (e.g., .com, .org, .edu).' }
  }

  // Validate all domain labels (alphanumeric and hyphens, not starting or ending with hyphen)
  for (const label of domainLabels) {
    if (!label || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { isValid: false, error: 'Domain contains invalid characters.' }
    }
  }

  // ── Strict Authenticity Checks (Enforced on Sign Up) ──────────────────────
  if (options.isSignUp) {
    // 1. Check disposable email domain list
    if (DISPOSABLE_EMAIL_DOMAINS.has(domainPart)) {
      return {
        isValid: false,
        domain: domainPart,
        isDisposable: true,
        error: 'Disposable and temporary email addresses are not allowed. Please use an authentic email address.',
      }
    }

    // Also check wildcard subdomains (e.g. "xyz.mailinator.com")
    for (const disposable of DISPOSABLE_EMAIL_DOMAINS) {
      if (domainPart.endsWith(`.${disposable}`)) {
        return {
          isValid: false,
          domain: domainPart,
          isDisposable: true,
          error: 'Disposable and temporary email services are not allowed. Please use an authentic email address.',
        }
      }
    }

    // 2. Check test/placeholder domains
    if (TEST_OR_PLACEHOLDER_DOMAINS.has(domainPart)) {
      return {
        isValid: false,
        domain: domainPart,
        isTestDomain: true,
        error: 'Test, example, and placeholder domains are not allowed. Please use an authentic email address.',
      }
    }

    // 3. Check for suspicious / random local-part
    const localCheck = checkSuspiciousLocalPart(localPart)
    if (localCheck.isSuspicious) {
      return {
        isValid: false,
        domain: domainPart,
        isSuspiciousLocal: true,
        error: localCheck.reason || 'Please enter an authentic email address.',
      }
    }
  }

  return {
    isValid: true,
    error: null,
    domain: domainPart,
  }
}
