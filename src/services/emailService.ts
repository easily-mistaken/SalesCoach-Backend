import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendInviteEmailParams {
  email: string;
  inviteId: string;
  organizationName: string;
  inviterName: string;
  inviterRole: string;
}

export async function sendInviteEmail({
  email,
  inviteId,
  organizationName,
  inviterName,
  inviterRole,
}: SendInviteEmailParams) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const inviteUrl = `${frontendUrl}/join/${inviteId}`;

  try {
    const { data, error } = await resend.emails.send({
      from: `SalesCoach <noreply@prajjwal.site>`, // Configure your verified domain in Resend
      to: [email],
      subject: `You've been invited to join ${organizationName} on SalesCoach.guru`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>You've been invited to join SalesCoach.guru</h2>
          <p>Hello,</p>
          <p><strong>${inviterName}</strong> (${inviterRole}) has invited you to join <strong>${organizationName}</strong> on SalesCoach.guru.</p>
          <p>SalesCoach.guru is a platform that helps sales teams improve their performance through coaching and analytics.</p>
          <div style="margin: 30px 0;">
            <a href="${inviteUrl}" style="background-color: #0284c7; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Accept Invitation</a>
          </div>
          <p>This invite link will expire in 7 days.</p>
          <p>If you have any questions, please contact ${inviterName}.</p>
        </div>
      `,
    });

    if (error) {
      console.error("Error sending invite email:", error);
      throw new Error(`Failed to send invite email: ${error.message}`);
    }

    return data;
  } catch (error) {
    console.error("Exception sending invite email:", error);
    throw error;
  }
}
