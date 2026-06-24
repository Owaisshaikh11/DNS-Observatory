
/**
 * CountryFlag
 *
 * Renders a high-quality, flat country flag from the flag-icons SVG library
 * with proper CSS styling, or gracefully falls back to a Unicode emoji flag/globe
 * if the country code is missing or invalid.
 *
 * @param {string} countryCode - ISO 2-letter country code (e.g. "US", "RU")
 * @param {string} fallbackFlag - Emoji/symbol fallback (e.g. "🇺🇸", "🌐")
 * @param {string} className - Additional CSS classes
 */
const CountryFlag = ({ countryCode, fallbackFlag = '🌐', className = '' }) => {
  // Return fallback immediately if no country code is provided
  if (!countryCode || typeof countryCode !== 'string' || countryCode.trim().length !== 2) {
    return <span className="select-none inline-block align-middle">{fallbackFlag}</span>;
  }

  const cleanCode = countryCode.trim().toLowerCase();

  // If width/height classes are not explicitly provided, apply default dimensions (16px x 12px)
  const hasWidth = className.includes('w-');
  const hasHeight = className.includes('h-');
  const defaultSizeClass = `${hasWidth ? '' : 'w-4'} ${hasHeight ? '' : 'h-3'}`;

  return (
    <span
      className={`fi fi-${cleanCode} inline-block align-middle rounded-[2px] shrink-0 ${defaultSizeClass} ${className}`}
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    />
  );
};

export default CountryFlag;
