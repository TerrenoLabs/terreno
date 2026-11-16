---
title: Connect an AI assistant to your account
area: account
audience: user
platforms: [web]
questions:
  - How do I connect Claude or ChatGPT to my account?
  - How do I give an AI assistant read-only access?
  - What does "Read your data" or "Change your data" mean?
  - Why does the connection page say "Request expired"?
  - How do I stop an AI assistant from using my account?
screens:
  - "example-frontend/app/oauth/consent.tsx"
added: mcp-oauth-consent-screen
---

# Connect an AI assistant to your account

## What it does

Connecting an AI assistant, such as Claude or ChatGPT, lets it read your todos, and if you
allow it, change them for you. You choose how much access it gets before it connects.

## How to use it

1. In your AI assistant, add this app as a connector and start connecting. A page from this
   app opens in your browser.
2. If you are not signed in, sign in on that page with your **Email** and **Password**,
   or tap **Continue with Google**, **Continue with GitHub**, or **Continue with Apple**. If the app asks you to accept its terms first,
   accept them; the connection page opens next.
3. Check the page: it names the assistant, says it "wants to access your account through
   MCP.", and under "Only approve if you started this from" shows the site you came from.
   If you did not just start a connection on that site, tap **Deny**.
4. Under **Requested access**, choose what the assistant may do:
   - **Read your data**: see your records. It cannot change anything.
   - **Change your data**: create, update, and delete records for you.

   Uncheck **Change your data** to give read-only access. Keep at least one box checked.
5. Tap **Approve**. Your browser returns to the assistant, which is now connected.

To refuse, tap **Deny**. The assistant is not connected and gets no access.

## Intended use

Use this to let an assistant you trust work with your own records. With only **Read your
data** checked, the assistant can look things up but cannot add, edit, or delete anything.
The page shows **Signed in as** with your email; the assistant gets access to that account.

A connection request lasts a few minutes. If the page shows **Request expired**,
**Request already decided**, or **Request not found**, start connecting again from the
assistant. If it shows **Sign in required**, sign in again.

To cut off every connected assistant, reset your password; each one must connect again
afterward.

## Related

- [Sign in](sign-in.md)
- [Reset your password](reset-password.md)
