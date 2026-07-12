import emailjs from '@emailjs/browser';

export function isEmailJsConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_EMAILJS_SERVICE_ID
    && import.meta.env.VITE_EMAILJS_TEMPLATE_ID
    && import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
  );
}

export async function sendLoginPasscode(email: string, passcode: string, timeMinutes: string): Promise<void> {
  const serviceId = import.meta.env.VITE_EMAILJS_SERVICE_ID;
  const templateId = import.meta.env.VITE_EMAILJS_TEMPLATE_ID;
  const publicKey = import.meta.env.VITE_EMAILJS_PUBLIC_KEY;
  if (!serviceId || !templateId || !publicKey) throw new Error('邮件服务未配置');
  await emailjs.send(serviceId, templateId, {
    email,
    passcode,
    time: `${timeMinutes} 分钟`,
  }, { publicKey });
}
