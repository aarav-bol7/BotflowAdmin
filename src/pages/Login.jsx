import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Shield, Mail, Phone, ArrowRight, ArrowLeft, CheckCircle, RotateCw, Lock
} from 'lucide-react';
import { authService } from '../api/authService';
import { isAuthenticated, isTokenExpired, saveAuthTokens } from '../utils/adminAuthUtils';
import PhoneInputWithCountryDropdown from '../components/PhoneInputWithCountryDropdown';
import TurnstileWidget from '../components/TurnstileWidget';

function Login() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    identifier: '',
    otp: '',
  });
  const [loginMethod, setLoginMethod] = useState('email'); // 'email' or 'whatsapp'
  const [step, setStep] = useState('identifier'); // 'identifier' or 'otp'
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [otpExpirySeconds, setOtpExpirySeconds] = useState(0);
  const otpInputRefs = useRef([]);
  const [otpRequestUuid, setOtpRequestUuid] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const handleTurnstileToken = useCallback((token) => setTurnstileToken(token), []);

  // Redirect if already authenticated
  useEffect(() => {
    const tokenExists = isAuthenticated();
    const tokenValid = tokenExists && !isTokenExpired();
    if (tokenValid) {
      navigate('/bot', { replace: true });
    }
  }, [navigate]);

  // Resend cooldown timer
  useEffect(() => {
    let interval = null;
    if (isTimerActive && otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer((prev) => (prev <= 1 ? 0 : prev - 1));
      }, 1000);
    } else if (otpTimer === 0) {
      setIsTimerActive(false);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, otpTimer]);

  // OTP expiry countdown
  useEffect(() => {
    if (step !== 'otp' || otpExpirySeconds <= 0) return;
    const t = setInterval(() => {
      setOtpExpirySeconds((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [step, otpExpirySeconds]);

  // Disable copy/paste/cut on identifier inputs
  useEffect(() => {
    const handleCopy = (e) => {
      const target = e.target;
      if (target.closest?.('[data-allow-paste]')) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const handlePaste = (e) => {
      const target = e.target;
      if (target.closest?.('[data-otp-inputs]')) return;
      if (target.closest?.('[data-allow-paste]')) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const handleCut = (e) => {
      const target = e.target;
      if (target.closest?.('[data-allow-paste]')) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('paste', handlePaste, true);
    document.addEventListener('cut', handleCut, true);
    return () => {
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('paste', handlePaste, true);
      document.removeEventListener('cut', handleCut, true);
    };
  }, []);

  const handleResendOtp = async () => {
    setResendLoading(true);
    try {
      if (!turnstileToken) {
        toast.error("Please complete the captcha challenge");
        setResendLoading(false);
        return;
      }
      const resendRes = await authService.sendOtp(formData.identifier, 'login', turnstileToken);
      const resendUuid = resendRes?.data?.otp_request_uuid ?? resendRes?.otp_request_uuid ?? null;
      if (resendUuid) setOtpRequestUuid(resendUuid);
      toast.success('OTP resent successfully!');
      setOtpTimer(60);
      setIsTimerActive(true);
      setOtpExpirySeconds(5 * 60);
      setFormData((prev) => ({ ...prev, otp: '' }));
      setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
    } catch (error) {
      console.error('OTP resend error:', error);
      toast.error(error.message || 'Failed to resend OTP. Please try again.');
    } finally {
      setResendLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    if (step === 'identifier') {
      try {
        if (loginMethod === 'whatsapp') {
          const cleanNumber = formData.identifier.replace(/\D/g, '');
          if (cleanNumber.length < 7 || cleanNumber.length > 15) {
            toast.error('Phone number must be between 7 and 15 digits including country code');
            setIsLoading(false);
            return;
          }
        }

        if (loginMethod === 'email') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(formData.identifier)) {
            toast.error('Please enter a valid email address');
            setIsLoading(false);
            return;
          }
        }

        if (!turnstileToken) {
          toast.error("Please complete the captcha challenge");
          setIsLoading(false);
          return;
        }

        const sendOtpRes = await authService.sendOtp(formData.identifier, 'login', turnstileToken);
        const uuid = sendOtpRes?.data?.otp_request_uuid ?? sendOtpRes?.otp_request_uuid ?? null;
        if (uuid) setOtpRequestUuid(uuid);
        setStep('otp');
        toast.success('OTP sent to your email and WhatsApp successfully!');
        setOtpTimer(60);
        setIsTimerActive(true);
        setOtpExpirySeconds(5 * 60);
        setFormData((prev) => ({ ...prev, otp: '' }));
        setTimeout(() => otpInputRefs.current[0]?.focus(), 100);
      } catch (error) {
        console.error('OTP sending error:', error);
        const isNetworkError = error?.message === 'Failed to fetch' || error?.name === 'TypeError';
        const message = isNetworkError
          ? 'Cannot reach the server. Check that the auth backend is running and VITE_API_BASE_URL in .env points to it.'
          : (error.message || 'Failed to send OTP. Please try again.');
        toast.error(message);
      }
    } else {
      try {
        const response = await authService.login(formData.identifier, formData.otp, otpRequestUuid);
        const payload = response?.data ?? response ?? {};
        const access = payload.access ?? null;
        const refresh = payload.refresh ?? null;
        localStorage.removeItem('logged_out');
        saveAuthTokens(access, refresh, payload.user ?? null, payload);
        toast.success('Login successful! Redirecting...');
        navigate('/bot', { replace: true });
      } catch (error) {
        console.error('OTP verification error:', error);
        const isNetworkError = error?.message === 'Failed to fetch' || error?.name === 'TypeError';
        const message = isNetworkError
          ? 'Cannot reach the server. Check that the auth backend is running and VITE_API_BASE_URL in .env points to it.'
          : (error.message || 'Failed to verify OTP. Please try again.');
        toast.error(message);
      }
    }
    setIsLoading(false);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleOtpBoxChange = (index, value) => {
    const char = (value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || '').slice(0, 1);
    setFormData((prev) => {
      const current = (prev.otp || '').padEnd(6, ' ').split('');
      current[index] = char;
      const next = current.join('').replace(/\s/g, '').slice(0, 6);
      return { ...prev, otp: next };
    });
    if (char && index < 5) setTimeout(() => otpInputRefs.current[index + 1]?.focus(), 0);
  };

  const handleOtpBoxKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !formData.otp[index] && index > 0) {
      e.preventDefault();
      setFormData((prev) => {
        const arr = (prev.otp || '').split('');
        arr[index - 1] = '';
        return { ...prev, otp: arr.join('').slice(0, 6) };
      });
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData('text') || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    if (!text) return;
    setFormData((prev) => ({ ...prev, otp: text }));
    const nextIndex = Math.min(text.length, 5);
    setTimeout(() => otpInputRefs.current[nextIndex]?.focus(), 0);
  };

  const handleMethodChange = (method) => {
    setLoginMethod(method);
    setFormData((prev) => ({ ...prev, identifier: '' }));
    setStep('identifier');
  };

  const handleBackToIdentifier = () => {
    setStep('identifier');
    setFormData((prev) => ({ ...prev, otp: '' }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center p-4">
      {/* Background accent blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-600 to-indigo-700 dark:from-indigo-500 dark:to-indigo-600 rounded-xl shadow-lg shadow-indigo-500/30 mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Login</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Sign in with OTP verification
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/50 dark:border-slate-800/50 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Login Method Toggle — identifier step only */}
            {step === 'identifier' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                  Login with
                </label>
                <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  <button
                    type="button"
                    onClick={() => handleMethodChange('email')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-all ${
                      loginMethod === 'email'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Mail className="w-4 h-4" />
                    Email
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMethodChange('whatsapp')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 text-sm font-medium rounded-md transition-all ${
                      loginMethod === 'whatsapp'
                        ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Phone className="w-4 h-4" />
                    WhatsApp
                  </button>
                </div>
              </div>
            )}

            {/* Identifier field */}
            {step === 'identifier' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  {loginMethod === 'email' ? 'Email Address' : 'WhatsApp Number'}
                </label>
                {loginMethod === 'email' ? (
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail className="w-5 h-5 text-slate-400" />
                    </div>
                    <input
                      type="email"
                      value={formData.identifier}
                      onChange={(e) => handleInputChange('identifier', e.target.value)}
                      onCopy={(e) => e.preventDefault()}
                      onPaste={(e) => e.preventDefault()}
                      onCut={(e) => e.preventDefault()}
                      className="w-full pl-10 pr-4 py-3 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors"
                      placeholder="Enter your email"
                    />
                  </div>
                ) : (
                  <PhoneInputWithCountryDropdown
                    value={formData.identifier}
                    onChange={(value) => handleInputChange('identifier', value)}
                    placeholder="Enter phone number"
                  />
                )}
                {loginMethod === 'email' && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    OTP will be sent to both your email and phone number
                  </p>
                )}
              </div>
            )}

            {/* OTP step */}
            {step === 'otp' && (
              <div className="space-y-5" data-otp-inputs>
                {/* Confirmation banner */}
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm font-medium text-green-800 dark:text-green-300">
                    OTP sent to {formData.identifier}. {loginMethod === 'whatsapp' ? 'Check WhatsApp.' : 'Check your email.'}
                  </p>
                </div>

                <p className="text-center text-sm font-medium text-slate-700 dark:text-slate-300">
                  Enter 6-character OTP (letters &amp; numbers)
                </p>

                {/* Six OTP boxes */}
                <div className="flex justify-center gap-2">
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <input
                      key={i}
                      ref={(el) => { otpInputRefs.current[i] = el; }}
                      type="text"
                      inputMode="text"
                      autoComplete="one-time-code"
                      maxLength={1}
                      value={(formData.otp || '')[i] || ''}
                      onChange={(e) => handleOtpBoxChange(i, e.target.value)}
                      onKeyDown={(e) => handleOtpBoxKeyDown(i, e)}
                      onPaste={i === 0 ? handleOtpPaste : undefined}
                      onCopy={(e) => e.preventDefault()}
                      onCut={(e) => e.preventDefault()}
                      className="w-11 h-12 sm:w-12 sm:h-14 text-center text-lg font-semibold rounded-lg border-2 border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-colors"
                    />
                  ))}
                </div>

                {otpExpirySeconds > 0 && (
                  <p className="text-center text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">
                    OTP expires in {Math.floor(otpExpirySeconds / 60)}:{(otpExpirySeconds % 60).toString().padStart(2, '0')}
                  </p>
                )}

                {/* Verify button */}
                <button
                  type="submit"
                  disabled={isLoading || (formData.otp || '').length !== 6}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Verifying...</span>
                    </>
                  ) : (
                    <>
                      <span>Verify OTP</span>
                      <Lock className="w-5 h-5" />
                    </>
                  )}
                </button>

                {/* Bottom row: Change / Resend */}
                <div className="flex items-center justify-between text-sm">
                  <button
                    type="button"
                    onClick={handleBackToIdentifier}
                    className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4 flex-shrink-0 stroke-[2.5]" />
                    Change number or email
                  </button>
                  {isTimerActive && otpTimer > 0 ? (
                    <span className="flex items-center gap-1 text-indigo-400 select-none cursor-not-allowed" aria-disabled="true">
                      <RotateCw className="w-4 h-4 flex-shrink-0" />
                      Resend in {otpTimer}s
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResendOtp}
                      disabled={resendLoading}
                      className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <RotateCw className="w-4 h-4 flex-shrink-0" />
                      {resendLoading ? 'Resending...' : 'Resend OTP'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Turnstile Widget — identifier step only */}
            {step === 'identifier' && (
              <TurnstileWidget onToken={handleTurnstileToken} action="login" />
            )}

            {/* Send OTP button — identifier step only */}
            {step === 'identifier' && (
              <button
                type="submit"
                disabled={isLoading || !formData.identifier || !turnstileToken}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 dark:from-indigo-500 dark:to-indigo-600 hover:shadow-lg hover:shadow-indigo-500/30 disabled:opacity-60 text-white rounded-lg font-semibold transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isLoading ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Sending OTP...</span>
                  </>
                ) : (
                  <>
                    <span>Send OTP via {loginMethod === 'email' ? 'Email' : 'WhatsApp'}</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            )}

          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;
