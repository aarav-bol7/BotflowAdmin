import { useState, useEffect, useRef } from 'react';
import PhoneInputLib, {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumber,
} from 'react-phone-number-input';
import 'react-phone-number-input/style.css';

const FLAG_BASE =
  'https://purecatamphetamine.github.io/country-flag-icons/3x2';
const displayNames = new Intl.DisplayNames(['en'], { type: 'region' });

function formatToInternational(phoneValue) {
  if (!phoneValue) return '';
  if (typeof phoneValue !== 'string') return '';
  if (phoneValue.startsWith('+')) return phoneValue;
  const digits = phoneValue.replace(/\D/g, '');
  if (digits.length > 0) return `+${digits}`;
  return '';
}

function formatToDigitsOnly(phoneValue) {
  if (!phoneValue) return '';
  const digits = String(phoneValue).replace(/\D/g, '');
  return digits.slice(0, 15);
}

function getCountryFromValue(internationalValue) {
  if (!internationalValue) return undefined;
  try {
    const parsed = parsePhoneNumber(internationalValue);
    return parsed?.country || undefined;
  } catch {
    return undefined;
  }
}

export default function PhoneInputWithCountryDropdown({
  value = '',
  onChange,
  placeholder = 'Enter phone number',
  disabled = false,
  className = '',
  id,
  'aria-label': ariaLabel = 'Phone number',
  autoComplete = 'tel',
}) {
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const countryDropdownRef = useRef(null);
  const internationalValue = formatToInternational(value);

  const [selectedCountry, setSelectedCountry] = useState(
    () => getCountryFromValue(internationalValue) || 'IN'
  );

  useEffect(() => {
    const country = getCountryFromValue(internationalValue);
    setSelectedCountry((prev) => country || prev);
  }, [internationalValue]);

  useEffect(() => {
    if (!showCountryDropdown) return;
    const handleClickOutside = (e) => {
      if (
        countryDropdownRef.current &&
        !countryDropdownRef.current.contains(e.target)
      ) {
        setShowCountryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCountryDropdown]);

  const handleLibChange = (newValue) => {
    if (onChange) onChange(formatToDigitsOnly(newValue || ''));
    const country = newValue ? getCountryFromValue(newValue) : null;
    if (country) setSelectedCountry(country);
  };

  const handleCountrySelect = (country) => {
    setSelectedCountry(country);
    const code = getCountryCallingCode(country);
    const parsed = internationalValue
      ? parsePhoneNumber(internationalValue)
      : null;
    const national = parsed ? parsed.nationalNumber : '';
    const newPhone = `+${code}${national}`;
    if (onChange) onChange(formatToDigitsOnly(newPhone));
    setShowCountryDropdown(false);
  };

  return (
    <div
      ref={countryDropdownRef}
      className={`relative phone-input-custom-wrapper ${className}`}
    >
      <div className="phone-input-custom">
        <PhoneInputLib
          key={selectedCountry}
          international
          defaultCountry={selectedCountry}
          value={internationalValue}
          onChange={handleLibChange}
          placeholder={placeholder}
          disabled={disabled}
          numberInputProps={{
            id: id || 'phone',
            'aria-label': ariaLabel,
            autoComplete,
            required: true,
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => setShowCountryDropdown((v) => !v)}
        className="absolute left-0 top-0 bottom-0 w-[5.75rem] z-10 cursor-pointer rounded-l-md"
        aria-label="Select country"
        aria-expanded={showCountryDropdown}
        tabIndex={0}
      />
      {showCountryDropdown && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 w-full max-h-[7.5rem] overflow-y-auto overflow-x-hidden rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl py-1">
          {getCountries().map((country) => {
            const code = getCountryCallingCode(country);
            const name = displayNames.of(country) || country;
            return (
              <button
                key={country}
                type="button"
                onClick={() => handleCountrySelect(country)}
                className="w-full flex items-center pl-3 pr-3 py-2.5 text-left text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
              >
                <span className="w-6 h-4 shrink-0 flex items-center justify-center mr-12">
                  <img
                    alt=""
                    className="w-full h-full object-cover rounded"
                    loading="lazy"
                    src={`${FLAG_BASE}/${country}.svg`}
                  />
                </span>
                <span className="font-medium text-slate-500 dark:text-slate-200 min-w-[3.25rem] shrink-0 tabular-nums mr-6">
                  +{code}
                </span>
                <span className="truncate min-w-0">{name}</span>
              </button>
            );
          })}
        </div>
      )}
      <style>{`
        .phone-input-custom-wrapper .phone-input-custom {
          position: relative;
          background-color: white !important;
          border-radius: 0.5rem !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInput {
          background-color: white !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput {
          width: 100% !important;
          padding-left: 5.25rem !important;
          padding-right: 1rem !important;
          padding-top: 0.75rem !important;
          padding-bottom: 0.75rem !important;
          font-size: 0.875rem !important;
          line-height: 1.25rem !important;
          border-radius: 0.5rem !important;
          border: 1px solid rgb(203 213 225) !important;
          background-color: white !important;
          color: #0f172a !important;
          -webkit-text-fill-color: #0f172a !important;
          caret-color: black !important;
          transition: all 0.2s ease !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput::placeholder {
          color: rgb(100 116 139) !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput::selection {
          background-color: rgb(203 213 225) !important;
          color: rgb(15 23 42) !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill,
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill:hover,
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px white inset !important;
          box-shadow: 0 0 0 1000px white inset !important;
          color: #0f172a !important;
          -webkit-text-fill-color: #0f172a !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput {
          border-color: rgb(71 85 105) !important;
          background-color: rgb(30 41 59) !important;
          color: white !important;
          -webkit-text-fill-color: white !important;
          caret-color: white !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput::placeholder {
          color: rgb(148 163 184) !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput::selection {
          background-color: rgb(71 85 105) !important;
          color: white !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill,
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill:hover,
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:-webkit-autofill:focus {
          -webkit-box-shadow: 0 0 0 1000px rgb(30 41 59) inset !important;
          box-shadow: 0 0 0 1000px rgb(30 41 59) inset !important;
          color: white !important;
          -webkit-text-fill-color: white !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:focus {
          outline: none !important;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.5) !important;
          border-color: rgb(59 130 246) !important;
          color: #0f172a !important;
          -webkit-text-fill-color: #0f172a !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputInput:focus {
          color: white !important;
          -webkit-text-fill-color: white !important;
          caret-color: white !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom,
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInput {
          background-color: rgb(30 41 59) !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountry {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          height: 100%;
          z-index: 5;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding-left: 0.75rem;
          padding-right: 0.5rem;
          border-right: 1px solid rgb(226 232 240);
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountry {
          border-right-color: rgb(71 85 105);
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountryIcon {
          width: 1.5rem !important;
          height: 1.125rem !important;
          border-radius: 0.125rem !important;
          box-shadow: 0 1px 2px rgba(0,0,0,0.1) !important;
          border: 1px solid rgba(0,0,0,0.1) !important;
          overflow: hidden !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountryIcon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountrySelect {
          font-size: 0.75rem !important;
          font-weight: 500 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
          color: rgb(51 65 85) !important;
          cursor: pointer !important;
          outline: none !important;
          appearance: none !important;
          pointer-events: none !important;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountrySelect {
          color: white !important;
          -webkit-text-fill-color: white !important;
        }
        .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountrySelectArrow {
          display: inline-block;
          margin-left: 0.35rem;
          width: 14px;
          height: 14px;
          border: none !important;
          transform: none !important;
          background: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23334155' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e") no-repeat center;
          background-size: contain;
          opacity: 1;
        }
        .dark .phone-input-custom-wrapper .phone-input-custom .PhoneInputCountrySelectArrow {
          background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
