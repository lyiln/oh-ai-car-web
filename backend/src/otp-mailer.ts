import nodemailer from 'nodemailer';
import type { Config } from './config.js';

export interface OtpMailer {
  readonly available: boolean;
  sendLoginPasscode(input: { to: string; passcode: string; expiresInMinutes: number }): Promise<void>;
}

export function createSmtpOtpMailer(config: Config): OtpMailer {
  const available = Boolean(config.smtpHost && config.smtpUser && config.smtpPassword && config.smtpFrom);
  const transporter = available
    ? nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.smtpUser, pass: config.smtpPassword },
    })
    : null;

  return {
    available,
    async sendLoginPasscode({ to, passcode, expiresInMinutes }) {
      if (!transporter || !config.smtpFrom) throw new Error('SMTP is not configured');
      await transporter.sendMail({
        from: config.smtpFrom,
        to,
        subject: '巡牌通管理员登录验证码',
        text: `你的巡牌通管理员登录验证码是 ${passcode}，${expiresInMinutes} 分钟内有效。若非本人操作，请忽略此邮件。`,
      });
    },
  };
}
