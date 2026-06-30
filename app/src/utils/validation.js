/**
 * Validates a domain name string against standard DNS syntax rules.
 * @param {string} val The input domain string
 * @returns {string[]} An array of validation error messages, empty if valid
 */
export const getValidationErrors = (val) => {
  const errors = [];
  if (!val) return errors;

  if (/\s/.test(val)) {
    errors.push("Spaces are not allowed");
  }

  if (!/^[a-z0-9\-_.]*$/i.test(val)) {
    errors.push("Only alphanumeric characters, '-', '_', and '.' are allowed");
  }

  const parts = val.split('.');
  if (parts.length < 2) {
    errors.push("Must include a dot followed by an extension (e.g. .com)");
  } else {
    const tld = parts[parts.length - 1];
    if (tld.length < 2) {
      errors.push("Domain extension (TLD) must be at least 2 characters long");
    }
    if (!/^[a-z0-9]*$/i.test(tld)) {
      errors.push("Domain extension must be alphanumeric");
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i];
    if (segment.startsWith('-') || segment.endsWith('-')) {
      errors.push("Segments cannot start or end with a hyphen");
      break;
    }
    if (segment.length > 63) {
      errors.push("Domain segment cannot exceed 63 characters");
    }
    if (i < parts.length - 1 && segment === '') {
      errors.push("Consecutive dots or empty labels are not allowed");
      break;
    }
  }

  if (val.length > 253) {
    errors.push("Total domain name length cannot exceed 253 characters");
  }

  return errors;
};
