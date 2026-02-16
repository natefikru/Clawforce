import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMail, createTransport } = vi.hoisted(() => {
  const sendMailMock = vi.fn();
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return {
    sendMail: sendMailMock,
    createTransport: createTransportMock,
  };
});

vi.mock("nodemailer", () => ({
  default: { createTransport },
}));

import { sendEmailAlert } from "../../../src/alerts/notifiers/email.js";

describe("sendEmailAlert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses SMTP transport when smtp credentials are configured", async () => {
    await sendEmailAlert(
      {
        enabled: true,
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        username: "alerts@example.com",
        password: "secret",
        from: "alerts@example.com",
        to: ["ops@example.com"],
      },
      {
        ts: "2026-02-15T00:00:00.000Z",
        severity: "warning",
        type: "budget_exceeded",
        message: "Budget exceeded",
      },
    );

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
