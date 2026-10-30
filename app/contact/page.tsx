'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Mail,
  Phone,
  MapPin,
  MessageCircle,
  CalendarCheck,
  Send,
  CheckCircle2,
  FileText,
  ShieldCheck,
} from 'lucide-react';
import { BUSINESS_CONFIG, getFormattedAddress } from '@/lib/business-config';

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [orderId, setOrderId] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const formattedAddress = getFormattedAddress();

  // There is no server-side mail service: the message is handed to the visitor's own email app,
  // addressed to the support mailbox, so nothing is silently lost.
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const subject = `School Bite enquiry${orderId.trim() ? ` – Order ${orderId.trim()}` : ''}`;
    const body = [
      message.trim(),
      '',
      `Name: ${name.trim()}`,
      `Email: ${email.trim()}`,
      phone.trim() ? `Phone: ${phone.trim()}` : '',
      orderId.trim() ? `Order ID: ${orderId.trim()}` : '',
    ]
      .filter((line, i) => line !== '' || i === 1)
      .join('\n');
    window.location.href = `mailto:${BUSINESS_CONFIG.supportEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setSubmitting(false);
    setSubmitted(true);
  };

  const whatsappNumber = BUSINESS_CONFIG.supportPhone.replace(/\D/g, '');

  return (
    <div className="min-h-screen bg-slate-50/50 py-10 sm:py-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        {/* Header */}
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 border border-amber-200/80 rounded-full text-xs font-bold text-amber-800">
            <Mail className="w-3.5 h-3.5 text-amber-600" />
            <span>Customer Support</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            Contact <span className="text-amber-600">{BUSINESS_CONFIG.brandName}</span>
          </h1>

          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            For assistance with meal orders, payments, account-related questions or general enquiries, contact our support team.
          </p>
        </div>

        {/* Contact Info Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Card 1: Email Support */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <Mail className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Email Support</h2>
                <p className="text-xs text-slate-500 mt-1">
                  For meal inquiries, payments, and general assistance:
                </p>
              </div>
            </div>
            <a
              href={`mailto:${BUSINESS_CONFIG.supportEmail}`}
              className="text-xs sm:text-sm font-bold text-amber-600 hover:text-amber-700 hover:underline block break-all pt-2 border-t border-slate-100"
            >
              {BUSINESS_CONFIG.supportEmail}
            </a>
          </div>

          {/* Card 2: Phone Support */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                <Phone className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">Phone Support</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Direct phone assistance for parents:
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <a
                href={`tel:${BUSINESS_CONFIG.supportPhoneRaw}`}
                className="text-xs sm:text-sm font-bold text-emerald-700 hover:underline block"
              >
                {BUSINESS_CONFIG.supportPhone} / {BUSINESS_CONFIG.supportPhoneRaw}
              </a>
              <p className="text-[11px] text-slate-500 font-medium">
                {BUSINESS_CONFIG.supportAvailability}
              </p>
            </div>
          </div>

          {/* Card 3: WhatsApp Support */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-green-50 text-green-600 flex items-center justify-center font-bold">
                <MessageCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">WhatsApp Support</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Quick chat support for parents and orders:
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <a
                href={`https://wa.me/${whatsappNumber}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs sm:text-sm font-bold text-green-700 hover:underline block"
              >
                {BUSINESS_CONFIG.whatsAppSupport} ({BUSINESS_CONFIG.supportPhone})
              </a>
              <p className="text-[11px] text-slate-500 font-medium">
                {BUSINESS_CONFIG.supportAvailability}
              </p>
            </div>
          </div>

          {/* Card 4: School / Canteen Location */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                <MapPin className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900">School & Canteen Location</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Operating location of school & canteen:
                </p>
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-800 leading-relaxed">
                {formattedAddress}
              </p>
            </div>
          </div>
        </div>

        {/* Contact Form & Policy Navigation Section */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Inquiry Form */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-xs space-y-6">
            <div>
              <h2 className="text-xl font-bold text-slate-900">Send an Inquiry</h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Fill in the form below and our support team will get in touch with you.
              </p>
            </div>

            {submitted ? (
              <div className="p-6 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <h3 className="text-base font-bold text-emerald-900">Your email app has opened</h3>
                <p className="text-xs sm:text-sm text-emerald-700 leading-relaxed">
                  Please press <strong>Send</strong> in your email app to deliver your message. If it did not open, email{' '}
                  <a className="underline font-bold" href={`mailto:${BUSINESS_CONFIG.supportEmail}`}>{BUSINESS_CONFIG.supportEmail}</a> or call{' '}
                  <a className="underline font-bold" href={`tel:${BUSINESS_CONFIG.supportPhoneRaw}`}>{BUSINESS_CONFIG.supportPhone}</a>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSubmitted(false);
                    setMessage('');
                    setOrderId('');
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
                >
                  Send Another Message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Your Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your full name"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity('Please enter a valid email address.')}
                      onInput={(e) => (e.target as HTMLInputElement).setCustomValidity('')}
                      placeholder="Enter your email address"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 transition-all font-medium"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Enter your contact number"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 transition-all font-medium"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Order ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={orderId}
                      onChange={(e) => setOrderId(e.target.value)}
                      placeholder="e.g. ORD-12345"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 transition-all font-mono font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Your Message / Query <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Please describe your question or issue in detail..."
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500 transition-all font-medium resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-xs rounded-xl shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                >
                  {submitting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Submit Inquiry</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Quick Support & Policies Card */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-xs space-y-4">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CalendarCheck className="w-4 h-4 text-amber-500" />
                <span>Support Details</span>
              </h3>

              <div className="space-y-3 text-xs text-slate-600">
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Operating Business</span>
                  <span className="font-bold text-slate-800">{BUSINESS_CONFIG.legalEntityName}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Trade / Business Names</span>
                  <span className="font-bold text-slate-800 text-right text-[11px]">
                    BRIGHT DESIGNERS / NEW BRIGHT XEROX / BRIGHT CATERING
                  </span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Legal Proprietor</span>
                  <span className="font-bold text-slate-800">{BUSINESS_CONFIG.proprietorName}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Platform Brand</span>
                  <span className="font-bold text-slate-800">{BUSINESS_CONFIG.brandName}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Official Website</span>
                  <a href={BUSINESS_CONFIG.websiteUrl} className="font-bold text-amber-700 hover:underline">
                    {BUSINESS_CONFIG.websiteUrl}
                  </a>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Operating School</span>
                  <span className="font-bold text-slate-800">{BUSINESS_CONFIG.schoolName}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Support Hours</span>
                  <span className="font-bold text-slate-800 text-right text-[11px]">{BUSINESS_CONFIG.supportAvailability}</span>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Support Email</span>
                  <a href={`mailto:${BUSINESS_CONFIG.supportEmail}`} className="font-bold text-amber-700 hover:underline">
                    {BUSINESS_CONFIG.supportEmail}
                  </a>
                </div>
                <div className="flex justify-between pb-2 border-b border-slate-100">
                  <span className="font-medium text-slate-500">Support Phone</span>
                  <a href={`tel:${BUSINESS_CONFIG.supportPhoneRaw}`} className="font-bold text-slate-800 hover:underline">
                    {BUSINESS_CONFIG.supportPhone} ({BUSINESS_CONFIG.supportPhoneRaw})
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium text-slate-500">WhatsApp</span>
                  <span className="font-bold text-green-700">{BUSINESS_CONFIG.whatsAppSupport} ({BUSINESS_CONFIG.supportPhoneRaw})</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center gap-2 text-[11px] text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Secure online transactions powered by certified payment partner ({BUSINESS_CONFIG.paymentGatewayPartner}).</span>
              </div>
            </div>

            {/* Quick Policies Link */}
            <div className="p-5 bg-white rounded-3xl border border-slate-200/80 shadow-xs text-xs space-y-3">
              <p className="font-bold text-slate-900 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-amber-600" />
                <span>Customer Policies & Information</span>
              </p>
              <p className="text-slate-500 text-[11px] leading-relaxed">
                Review our comprehensive policies regarding pre-ordering, payments, data protection, fulfillment, and cancellations.
              </p>
              <div className="flex flex-col gap-2 pt-1 text-amber-700 font-semibold">
                <Link href="/terms-and-conditions" className="hover:underline flex items-center justify-between py-1 border-b border-slate-100">
                  <span>Terms & Conditions</span>
                  <span>→</span>
                </Link>
                <Link href="/privacy-policy" className="hover:underline flex items-center justify-between py-1 border-b border-slate-100">
                  <span>Privacy Policy</span>
                  <span>→</span>
                </Link>
                <Link href="/refund-policy" className="hover:underline flex items-center justify-between py-1 border-b border-slate-100">
                  <span>Refund & Cancellation Policy</span>
                  <span>→</span>
                </Link>
                <Link href="/delivery-policy" className="hover:underline flex items-center justify-between py-1">
                  <span>Shipping & Delivery Policy</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
