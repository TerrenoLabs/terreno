---
title: Browse and edit records in the admin panel
area: admin
audience: admin
platforms: [web, ios, android]
questions:
  - How do I open the admin panel?
  - How do I find a user or a todo as an admin?
  - How do I create, edit, or delete a record?
screens:
  - "example-frontend/app/(tabs)/profile.tsx"
  - "example-frontend/app/admin/index.tsx"
  - "example-frontend/app/admin/[model]/index.tsx"
  - "example-frontend/app/admin/[model]/[id].tsx"
added: user-guide-backfill
---

# Browse and edit records in the admin panel

## What it does

The admin panel lets administrators view and change the app's records, such as
**Users** and **Todos**, in tables with search, sorting, and paging.

## How to use it

1. Open the **Profile** tab and, under **Developer**, tap **Admin Panel**.
2. In the side menu, choose a section such as **Users** or **Todos**.
3. Search or sort the table to find a record, then tap its row to open it.
4. Change fields and tap **Save**.

To add a record, open a section and tap **Create**, fill in the fields, and tap
**Create**. To remove one, use its delete action and confirm
**Are you sure you want to delete this item?**. Tap **Refresh** to reload the table.

## Intended use

The admin panel is for administrators maintaining the app's data. It only appears for
accounts with admin access. Changes apply right away and affect every user, and deleted
records cannot be restored from the panel.

## Related

- [Set a user's password](set-user-password.md)
