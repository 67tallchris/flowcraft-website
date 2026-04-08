-- Waitlist emails table
CREATE TABLE IF NOT EXISTS waitlist_emails (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'website',
    notes TEXT,
    utm_data TEXT
);

-- Email templates table
CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    subject TEXT NOT NULL,
    body_markdown TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default welcome email template
INSERT OR IGNORE INTO email_templates (id, name, subject, body_markdown, is_active) VALUES (
    'welcome-email',
    'Welcome Email',
    "You're on the FlowCraft Waitlist! 🎯",
    '# You''re on the List!

Thanks for joining the **FlowCraft** waitlist! We''re building something special for people with ADHD who are tired of productivity systems that don''t work.

> "What conditions make it more possible for my brain to function well?"

## What happens next?

- We''ll notify you when the next group coaching cohort opens
- You''ll get exclusive early access to the FlowCraft webapp
- Join a community of ADHD knowledge workers

In the meantime, start noticing when you''re focused and when you''re not. That''s the first step of the FlowCraft Loop: **Observe → Experiment → Measure → Adjust**.

---

*— The FlowCraft Team*',
    1
);

-- Add utm_data column if table already exists (migration)
ALTER TABLE waitlist_emails ADD COLUMN utm_data TEXT;

-- Export logs table
CREATE TABLE IF NOT EXISTS export_logs (
    id TEXT PRIMARY KEY,
    exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    exported_count INTEGER NOT NULL,
    filter_tags TEXT,
    filter_date_from DATETIME,
    filter_date_to DATETIME,
    exported_by TEXT DEFAULT 'admin'
);

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    color TEXT DEFAULT '#0F4C5C',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Email-Tag junction table
CREATE TABLE IF NOT EXISTS email_tags (
    email_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (email_id, tag_id),
    FOREIGN KEY (email_id) REFERENCES waitlist_emails(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
);

-- Insert some default tags
INSERT OR IGNORE INTO tags (id, name, color) VALUES 
    (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))), 'cohort-1', '#0F4C5C'),
    (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))), 'vip', '#E36414'),
    (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))), 'follow-up', '#718096');
