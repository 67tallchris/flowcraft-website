-- Waitlist emails table
CREATE TABLE IF NOT EXISTS waitlist_emails (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT DEFAULT 'website',
    notes TEXT
);

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
