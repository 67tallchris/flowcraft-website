export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Initialize tables if they don't exist
    await initDB(env.DB);

    // API Routes
    if (pathname === '/api/waitlist' && request.method === 'POST') {
      return handleWaitlistSignup(request, env);
    }

    if (pathname === '/api/waitlist' && request.method === 'GET') {
      return handleGetWaitlist(request, env);
    }

    if (pathname === '/api/export' && request.method === 'POST') {
      return handleExport(request, env);
    }

    if (pathname === '/api/export-logs' && request.method === 'GET') {
      return handleGetExportLogs(request, env);
    }

    if (pathname === '/api/tags' && request.method === 'GET') {
      return handleGetTags(request, env);
    }

    if (pathname === '/api/tags' && request.method === 'POST') {
      return handleCreateTag(request, env);
    }

    if (pathname === '/api/tags' && request.method === 'DELETE') {
      return handleDeleteTag(request, env);
    }

    if (pathname === '/api/email-tags' && request.method === 'POST') {
      return handleAddEmailTag(request, env);
    }

    if (pathname === '/api/email-tags' && request.method === 'DELETE') {
      return handleRemoveEmailTag(request, env);
    }

    if (pathname === '/api/admin/login' && request.method === 'POST') {
      return handleAdminLogin(request, env);
    }

    if (pathname === '/api/admin/logout' && request.method === 'POST') {
      return handleAdminLogout();
    }

    if (pathname === '/api/admin/verify' && request.method === 'GET') {
      return handleAdminVerify(request, env);
    }

    if (pathname === '/api/email-templates' && request.method === 'GET') {
      return handleGetEmailTemplates(request, env);
    }

    if (pathname === '/api/email-templates' && request.method === 'POST') {
      return handleSaveEmailTemplate(request, env);
    }

    if (pathname === '/api/email-templates/preview' && request.method === 'POST') {
      return handlePreviewEmailTemplate(request, env);
    }

    // Admin Dashboard
    if (pathname === '/admin') {
      return new Response(getAdminHTML(), {
        headers: { 'content-type': 'text/html;charset=UTF-8' },
      });
    }

    // Main Website
    return new Response(getWebsiteHTML(), {
      headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
  },
};

// Initialize database tables
async function initDB(DB) {
  if (!DB) return;
  
  try {
    await DB.exec(`
      CREATE TABLE IF NOT EXISTS waitlist_emails (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        source TEXT DEFAULT 'website',
        notes TEXT,
        utm_data TEXT
      );

      CREATE TABLE IF NOT EXISTS export_logs (
        id TEXT PRIMARY KEY,
        exported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        exported_count INTEGER NOT NULL,
        filter_tags TEXT,
        filter_date_from DATETIME,
        filter_date_to DATETIME,
        exported_by TEXT DEFAULT 'admin'
      );
      
      CREATE TABLE IF NOT EXISTS tags (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#0F4C5C',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS email_tags (
        email_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (email_id, tag_id),
        FOREIGN KEY (email_id) REFERENCES waitlist_emails(id),
        FOREIGN KEY (tag_id) REFERENCES tags(id)
      );

      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default template if not exists
    try {
      await DB.prepare(
        `INSERT OR IGNORE INTO email_templates (id, name, subject, body_markdown, is_active) VALUES (?, ?, ?, ?, ?)`
      ).bind(
        'welcome-email',
        'Welcome Email',
        'You are on the FlowCraft Waitlist!',
        '# You are on the List!\n\nThanks for joining the FlowCraft waitlist!\n\n> What conditions make it more possible for my brain to function well?\n\n## What happens next?\n\n- We will notify you when the next group coaching cohort opens\n- You will get exclusive early access to the FlowCraft webapp\n- Join a community of ADHD knowledge workers\n\n---\n\n*The FlowCraft Team*',
        1
      ).run();
    } catch (e) {
      // Template might already exist
    }
  } catch (e) {
    // Tables might already exist
  }
}

// Generate UUID
function generateId() {
  return crypto.randomUUID();
}

// Handle waitlist signup
async function handleWaitlistSignup(request, env) {
  try {
    const body = await request.json();
    const { email, utm } = body;

    if (!email || !email.includes('@')) {
      return new Response(JSON.stringify({ error: 'Valid email required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const id = generateId();
    const utmData = utm ? JSON.stringify(utm) : null;
    const emailLower = email.toLowerCase();

    await env.DB.prepare(
      'INSERT INTO waitlist_emails (id, email, utm_data) VALUES (?, ?, ?)'
    ).bind(id, emailLower, utmData).run();

    // Send emails in background (don't block response)
    if (env.RESEND_API_KEY) {
      ctx.waitUntil(sendEmails(env, emailLower, utm));
    }

    return new Response(JSON.stringify({ success: true, message: 'Joined waitlist!' }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'Email already registered' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Send admin notification and confirmation email
async function sendEmails(env, email, utm) {
  const headers = {
    'Authorization': `Bearer ${env.RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  };

  // Get the active welcome email template
  let template = null;
  try {
    const { results } = await env.DB.prepare(
      "SELECT * FROM email_templates WHERE id = 'welcome-email' AND is_active = 1"
    ).all();
    if (results && results.length > 0) {
      template = results[0];
    }
  } catch (e) {
    // Fall back to hardcoded template
  }

  // Admin notification
  if (env.NOTIFICATION_EMAIL) {
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: 'FlowCraft <onboarding@resend.dev>',
        to: [env.NOTIFICATION_EMAIL],
        subject: `🎉 New FlowCraft Waitlist Signup: ${email}`,
        html: getAdminEmailHTML(email, utm),
      }),
    }).catch(() => {});
  }

  // Confirmation email to user
  if (template) {
    const renderedHTML = simpleMarkdownToHTML(template.body_markdown);
    const fullHTML = getEmailWrapperHTML(renderedHTML);
    
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: 'FlowCraft <onboarding@resend.dev>',
        to: [email],
        subject: template.subject,
        html: fullHTML,
      }),
    }).catch(() => {});
  } else {
    // Fallback to hardcoded template
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from: 'FlowCraft <onboarding@resend.dev>',
        to: [email],
        subject: "You're on the FlowCraft Waitlist! 🎯",
        html: getConfirmationEmailHTML(),
      }),
    }).catch(() => {});
  }
}

// Email wrapper - adds consistent styling container
function getEmailWrapperHTML(content) {
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #F9FAFB;">
  <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    ${content}
    <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #E2E8F0;">
      <p style="color: #718096; font-size: 14px; margin: 0;">— The FlowCraft Team</p>
      <p style="color: #A0AEC0; font-size: 12px; margin-top: 8px;"><a href="https://flowcraft-website.portercoaching.workers.dev/" style="color: #A0AEC0; text-decoration: none;">flowcraft-website.portercoaching.workers.dev</a></p>
    </div>
  </div>
</body>
</html>`;
}

// Admin notification email HTML
function getAdminEmailHTML(email, utm) {
  const utmRows = utm ? Object.entries(utm).map(([k, v]) => `<tr><td style="padding: 4px 12px; border-bottom: 1px solid #E2E8F0;">${k}</td><td style="padding: 4px 12px; border-bottom: 1px solid #E2E8F0;">${v}</td></tr>`).join('') : '<tr><td colspan="2" style="padding: 8px; color: #718096;">No UTM data</td></tr>';
  
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #F9FAFB;">
  <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <h1 style="color: #0F4C5C; margin-top: 0;">🎉 New Waitlist Signup</h1>
    <p style="font-size: 18px; color: #2D3748;"><strong>${email}</strong> just joined the FlowCraft waitlist!</p>
    
    <h3 style="color: #0F4C5C; border-bottom: 2px solid #E36414; padding-bottom: 8px;">UTM Data</h3>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <thead>
        <tr style="background: #F7FAFC;">
          <th style="text-align: left; padding: 8px 12px; border-bottom: 2px solid #E2E8F0;">Parameter</th>
          <th style="text-align: left; padding: 8px 12px; border-bottom: 2px solid #E2E8F0;">Value</th>
        </tr>
      </thead>
      <tbody>
        ${utmRows}
      </tbody>
    </table>
    
    <p style="margin-top: 24px; color: #718096; font-size: 14px;">View all signups: <a href="https://flowcraft-website.portercoaching.workers.dev/admin" style="color: #E36414;">Admin Dashboard</a></p>
  </div>
</body>
</html>`;
}

// Confirmation email HTML
function getConfirmationEmailHTML() {
  return `<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #F9FAFB;">
  <div style="max-width: 500px; margin: 0 auto; background: white; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="font-size: 48px; margin-bottom: 8px;">🎯</div>
      <h1 style="color: #0F4C5C; margin-top: 0;">You're on the List!</h1>
    </div>
    
    <p style="font-size: 16px; color: #2D3748; line-height: 1.6;">Thanks for joining the FlowCraft waitlist! We're building something special for people with ADHD who are tired of productivity systems that don't work.</p>
    
    <div style="background: #F0F4F8; border-radius: 8px; padding: 20px; margin: 24px 0; border-left: 4px solid #E36414;">
      <p style="margin: 0; color: #0F4C5C; font-style: italic; font-size: 16px;">"What conditions make it more possible for my brain to function well?"</p>
    </div>
    
    <h3 style="color: #0F4C5C;">What happens next?</h3>
    <ul style="color: #2D3748; line-height: 2;">
      <li>We'll notify you when the next group coaching cohort opens</li>
      <li>You'll get exclusive early access to the FlowCraft webapp</li>
      <li>Join a community of ADHD knowledge workers</li>
    </ul>
    
    <p style="color: #718096; font-size: 14px; margin-top: 24px;">In the meantime, start noticing when you're focused and when you're not. That's the first step of the FlowCraft Loop: <strong>Observe → Experiment → Measure → Adjust</strong>.</p>
    
    <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #E2E8F0;">
      <p style="color: #718096; font-size: 14px; margin: 0;">— The FlowCraft Team</p>
      <p style="color: #A0AEC0; font-size: 12px; margin-top: 8px;"><a href="https://flowcraft-website.portercoaching.workers.dev/" style="color: #A0AEC0; text-decoration: none;">flowcraft-website.portercoaching.workers.dev</a></p>
    </div>
  </div>
</body>
</html>`;
}

// Get waitlist emails with pagination and filtering
async function handleGetWaitlist(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const tag = url.searchParams.get('tag');
  const utmSource = url.searchParams.get('utmSource');
  const dateFrom = url.searchParams.get('dateFrom');
  const dateTo = url.searchParams.get('dateTo');
  const search = url.searchParams.get('search');
  const offset = (page - 1) * limit;

  let query = `
    SELECT e.*, GROUP_CONCAT(t.name) as tags, GROUP_CONCAT(t.color) as tag_colors
    FROM waitlist_emails e
    LEFT JOIN email_tags et ON e.id = et.email_id
    LEFT JOIN tags t ON et.tag_id = t.id
    WHERE 1=1
  `;
  let countQuery = `SELECT COUNT(*) as total FROM waitlist_emails e WHERE 1=1`;
  const params = [];
  const countParams = [];

  if (tag) {
    query += ` AND t.name = ?`;
    countQuery += ` AND e.id IN (SELECT et.email_id FROM email_tags et JOIN tags t ON et.tag_id = t.id WHERE t.name = ?)`;
    params.push(tag);
    countParams.push(tag);
  }

  if (utmSource) {
    query += ` AND e.utm_data LIKE ?`;
    countQuery += ` AND e.utm_data LIKE ?`;
    params.push(`%"utm_source":"${utmSource}"%`);
    countParams.push(`%"utm_source":"${utmSource}"%`);
  }

  if (dateFrom) {
    query += ` AND e.created_at >= ?`;
    countQuery += ` AND e.created_at >= ?`;
    params.push(dateFrom);
    countParams.push(dateFrom);
  }

  if (dateTo) {
    query += ` AND e.created_at <= ?`;
    countQuery += ` AND e.created_at <= ?`;
    params.push(dateTo);
    countParams.push(dateTo);
  }

  if (search) {
    query += ` AND e.email LIKE ?`;
    countQuery += ` AND e.email LIKE ?`;
    params.push(`%${search}%`);
    countParams.push(`%${search}%`);
  }

  query += ` GROUP BY e.id ORDER BY e.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const { results } = await env.DB.prepare(query).bind(...params).all();
  const { results: countResults } = await env.DB.prepare(countQuery).bind(...countParams).first();

  // Parse tags into arrays
  const emails = results.map(e => ({
    ...e,
    tags: e.tags ? e.tags.split(',').map((name, i) => ({
      name,
      color: e.tag_colors.split(',')[i]
    })) : []
  }));

  // Extract unique UTM sources for dropdown
  const utmSources = [...new Set(results
    .filter(e => e.utm_data)
    .map(e => {
      try {
        const utm = JSON.parse(e.utm_data);
        return utm.utm_source;
      } catch { return null; }
    })
    .filter(Boolean)
  )];

  return new Response(JSON.stringify({
    emails,
    total: countResults.total,
    page,
    limit,
    totalPages: Math.ceil(countResults.total / limit),
    utmSources
  }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Export emails
async function handleExport(request, env) {
  try {
    const body = await request.json();
    const { tag, dateFrom, dateTo, emailIds } = body;

    let query = `
      SELECT e.*, GROUP_CONCAT(t.name) as tags, GROUP_CONCAT(t.color) as tag_colors
      FROM waitlist_emails e
      LEFT JOIN email_tags et ON e.id = et.email_id
      LEFT JOIN tags t ON et.tag_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (emailIds && emailIds.length > 0) {
      const placeholders = emailIds.map(() => '?').join(',');
      query += ` AND e.id IN (${placeholders})`;
      params.push(...emailIds);
    } else {
      if (tag) {
        query += ` AND t.name = ?`;
        params.push(tag);
      }

      if (dateFrom) {
        query += ` AND e.created_at >= ?`;
        params.push(dateFrom);
      }

      if (dateTo) {
        query += ` AND e.created_at <= ?`;
        params.push(dateTo);
      }
    }

    query += ` GROUP BY e.id ORDER BY e.created_at DESC`;

    const { results } = await env.DB.prepare(query).bind(...params).all();

    // Parse tags
    const emails = results.map(e => ({
      ...e,
      tags: e.tags ? e.tags.split(',').map((name, i) => ({
        name,
        color: e.tag_colors.split(',')[i]
      })) : []
    }));

    // Log the export
    const logId = generateId();
    await env.DB.prepare(
      'INSERT INTO export_logs (id, exported_count, filter_tags, filter_date_from, filter_date_to) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      logId,
      emails.length,
      tag || null,
      dateFrom || null,
      dateTo || null
    ).run();

    return new Response(JSON.stringify({ success: true, emails, exportId: logId }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Export failed: ' + e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Get export logs
async function handleGetExportLogs(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM export_logs ORDER BY exported_at DESC LIMIT 100'
  ).all();

  return new Response(JSON.stringify({ logs: results }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Get all tags
async function handleGetTags(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT t.*, COUNT(et.email_id) as email_count FROM tags t LEFT JOIN email_tags et ON t.id = et.tag_id GROUP BY t.id ORDER BY t.name'
  ).all();

  return new Response(JSON.stringify({ tags: results }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Create a new tag
async function handleCreateTag(request, env) {
  try {
    const body = await request.json();
    const { name, color } = body;

    if (!name) {
      return new Response(JSON.stringify({ error: 'Tag name required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const id = generateId();
    await env.DB.prepare(
      'INSERT INTO tags (id, name, color) VALUES (?, ?, ?)'
    ).bind(id, name, color || '#0F4C5C').run();

    return new Response(JSON.stringify({ success: true, tag: { id, name, color: color || '#0F4C5C' } }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'Tag already exists' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to create tag' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Delete a tag
async function handleDeleteTag(request, env) {
  try {
    const url = new URL(request.url);
    const tagId = url.searchParams.get('id');

    if (!tagId) {
      return new Response(JSON.stringify({ error: 'Tag ID required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    // Remove from email_tags first
    await env.DB.prepare('DELETE FROM email_tags WHERE tag_id = ?').bind(tagId).run();
    await env.DB.prepare('DELETE FROM tags WHERE id = ?').bind(tagId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to delete tag' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Add tag to email
async function handleAddEmailTag(request, env) {
  try {
    const body = await request.json();
    const { emailId, tagId } = body;

    if (!emailId || !tagId) {
      return new Response(JSON.stringify({ error: 'Email ID and Tag ID required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    await env.DB.prepare(
      'INSERT OR IGNORE INTO email_tags (email_id, tag_id) VALUES (?, ?)'
    ).bind(emailId, tagId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to add tag' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Remove tag from email
async function handleRemoveEmailTag(request, env) {
  try {
    const body = await request.json();
    const { emailId, tagId } = body;

    if (!emailId || !tagId) {
      return new Response(JSON.stringify({ error: 'Email ID and Tag ID required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    await env.DB.prepare(
      'DELETE FROM email_tags WHERE email_id = ? AND tag_id = ?'
    ).bind(emailId, tagId).run();

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to remove tag' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Admin login
async function handleAdminLogin(request, env) {
  try {
    const body = await request.json();
    const { password } = body;

    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'flowcraft-admin';
    
    if (password === ADMIN_PASSWORD) {
      const token = generateId();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      
      // Store token in KV if available, otherwise use cookie only
      const response = new Response(JSON.stringify({ success: true }), {
        headers: { 
          'content-type': 'application/json',
          'Set-Cookie': `admin_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
        },
      });
      
      return response;
    }

    return new Response(JSON.stringify({ error: 'Invalid password' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Login failed' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Admin logout
async function handleAdminLogout() {
  return new Response(JSON.stringify({ success: true }), {
    headers: { 
      'content-type': 'application/json',
      'Set-Cookie': 'admin_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'
    },
  });
}

// Verify admin session
async function handleAdminVerify(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const hasToken = cookie.includes('admin_token=');
  
  if (hasToken) {
    return new Response(JSON.stringify({ authenticated: true }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ authenticated: false }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Get all email templates
async function handleGetEmailTemplates(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM email_templates ORDER BY name'
  ).all();

  return new Response(JSON.stringify({ templates: results }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Save/update email template
async function handleSaveEmailTemplate(request, env) {
  try {
    const body = await request.json();
    const { id, name, subject, body_markdown, is_active } = body;

    if (!name || !subject || !body_markdown) {
      return new Response(JSON.stringify({ error: 'Name, subject, and body are required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const templateId = id || generateId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO email_templates (id, name, subject, body_markdown, is_active, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET 
         name = excluded.name, 
         subject = excluded.subject, 
         body_markdown = excluded.body_markdown, 
         is_active = excluded.is_active,
         updated_at = excluded.updated_at`
    ).bind(templateId, name, subject, body_markdown, is_active ? 1 : 0, now).run();

    return new Response(JSON.stringify({ success: true, id: templateId }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed to save template: ' + e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Preview email template (render markdown to HTML)
async function handlePreviewEmailTemplate(request, env) {
  try {
    const body = await request.json();
    const { body_markdown } = body;

    const html = simpleMarkdownToHTML(body_markdown);

    return new Response(JSON.stringify({ html }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Preview failed: ' + e.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

// Simple markdown to HTML converter (no dependencies needed)
function simpleMarkdownToHTML(md) {
  let html = md;

  // Escape HTML entities first
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (```)
  html = html.replace(/```([\s\S]*?)```/g, '<pre style="background:#F7FAFC;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;"><code>$1</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:#F7FAFC;padding:2px 6px;border-radius:4px;font-size:0.9em;">$1</code>');

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3 style="color:#0F4C5C;margin:16px 0 8px;">$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2 style="color:#0F4C5C;margin:20px 0 10px;">$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1 style="color:#0F4C5C;margin:0 0 12px;">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote style="margin:16px 0;padding:16px 20px;background:#F0F4F8;border-left:4px solid #E36414;border-radius:0 8px 8px 0;font-style:italic;color:#0F4C5C;">$1</blockquote>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;">');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li style="margin:4px 0;">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul style="margin:8px 0;padding-left:24px;line-height:1.8;">$1</ul>');

  // Paragraphs (double newlines)
  html = html.replace(/\n\n/g, '</p><p style="margin:8px 0;line-height:1.6;">');
  html = '<p style="margin:8px 0;line-height:1.6;">' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p[^>]*><\/p>/g, '');
  html = html.replace(/<p[^>]*>(<(?:h[1-6]|ul|ol|blockquote|pre|hr)[^>]*>)/g, '$1');
  html = html.replace(/(<\/(?:h[1-6]|ul|ol|blockquote|pre|hr)[^>]*>)<\/p>/g, '$1');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Get website HTML
function getWebsiteHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FlowCraft | Find Your Focus with ADHD</title>
    <meta name="description" content="FlowCraft is the ongoing practice of designing, testing, and refining the conditions for your own focus. Join the waitlist for group coaching and exclusive app access.">
    <link rel="icon" type="image/png" href="https://pub-12f6d303b8dc4698be2adb7d80986978.r2.dev/favicon.png">
    <style>
        :root {
            --color-bg: #F9FAFB;
            --color-surface: #FFFFFF;
            --color-primary: #0F4C5C;
            --color-primary-dark: #09303b;
            --color-accent: #FF9A2F;
            --color-accent-hover: #F08020;
            --color-text-main: #2D3748;
            --color-text-muted: #718096;
            --color-border: #E2E8F0;
            --font-main: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --font-serif: 'Merriweather', Georgia, serif;
            --spacing-xs: 0.5rem;
            --spacing-sm: 1rem;
            --spacing-md: 2rem;
            --spacing-lg: 4rem;
            --spacing-xl: 6rem;
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 16px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
            --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
            --shadow-lg: 0 10px 15px rgba(0,0,0,0.1);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
            font-family: var(--font-main);
            background-color: var(--color-bg);
            color: var(--color-text-main);
            line-height: 1.6;
            -webkit-font-smoothing: antialiased;
        }
        img { max-width: 100%; height: auto; display: block; }
        a { color: var(--color-primary); text-decoration: none; transition: color 0.2s; }
        a:hover { color: var(--color-accent); }

        h1, h2, h3, h4 { color: var(--color-primary-dark); line-height: 1.2; margin-bottom: var(--spacing-sm); }
        h1 { font-size: 2.5rem; font-weight: 800; letter-spacing: -0.02em; }
        h2 { font-size: 2rem; font-weight: 700; }
        h3 { font-size: 1.25rem; font-weight: 600; }
        p { margin-bottom: var(--spacing-sm); font-size: 1.125rem; }
        .lead { font-size: 1.25rem; color: var(--color-text-muted); font-weight: 400; }
        .serif { font-family: var(--font-serif); font-style: italic; color: var(--color-text-main); }

        .btn {
            display: inline-block;
            padding: 0.875rem 1.75rem;
            border-radius: var(--radius-md);
            font-weight: 600;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
            font-size: 1rem;
        }
        .btn-primary {
            background-color: var(--color-accent);
            color: white;
            box-shadow: 0 4px 14px 0 rgba(227, 100, 20, 0.39);
        }
        .btn-primary:hover {
            background-color: var(--color-accent-hover);
            transform: translateY(-2px);
        }
        .btn-outline {
            background-color: transparent;
            border: 2px solid var(--color-primary);
            color: var(--color-primary);
        }
        .btn-outline:hover {
            background-color: var(--color-primary);
            color: white;
        }

        .input-group {
            display: flex;
            gap: var(--spacing-xs);
            max-width: 500px;
            margin: var(--spacing-md) auto;
        }
        input[type="email"] {
            flex: 1;
            padding: 0.875rem;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            font-size: 1rem;
        }
        input[type="email"]:focus {
            outline: none;
            border-color: var(--color-primary);
            box-shadow: 0 0 0 3px rgba(15, 76, 92, 0.1);
        }

        .container { width: 100%; max-width: 1200px; margin: 0 auto; padding: 0 var(--spacing-md); }
        .section { padding: var(--spacing-xl) 0; }
        .grid { display: grid; gap: var(--spacing-lg); }
        .grid-2 { grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); align-items: center; }
        .text-center { text-align: center; }
        .mb-md { margin-bottom: var(--spacing-md); }
        .mb-lg { margin-bottom: var(--spacing-lg); }

        header {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            background-color: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid var(--color-border);
            z-index: 1000;
            padding: var(--spacing-sm) 0;
        }
        nav { display: flex; justify-content: space-between; align-items: center; }
        .logo {
            font-weight: 800;
            font-size: 1.5rem;
            color: var(--color-primary-dark);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .nav-links { display: none; }
        @media(min-width: 768px) {
            .nav-links { display: flex; gap: var(--spacing-md); align-items: center; }
            h1 { font-size: 3.5rem; }
        }

        .hero {
            padding-top: 140px;
            padding-bottom: var(--spacing-xl);
            background: linear-gradient(180deg, #F0F4F8 0%, #FFFFFF 100%);
        }

        .quote-box {
            background-color: var(--color-primary-dark);
            color: white;
            padding: var(--spacing-lg);
            border-radius: var(--radius-lg);
            margin: var(--spacing-lg) 0;
            text-align: center;
        }
        .quote-box p { font-size: 1.5rem; color: #E2E8F0; margin: 0; }
        .quote-box span { font-family: var(--font-serif); color: var(--color-accent); display: block; margin-top: 1rem; font-size: 1rem; font-style: normal; letter-spacing: 1px; text-transform: uppercase;}

        .story-img {
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-lg);
            overflow: hidden;
            position: relative;
        }
        .story-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
        .story-img:hover img { transform: scale(1.02); }

        .card {
            background: var(--color-surface);
            padding: var(--spacing-md);
            border-radius: var(--radius-md);
            border: 1px solid var(--color-border);
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow-md);
            border-color: var(--color-primary);
        }
        .icon-box {
            width: 50px;
            height: 50px;
            background-color: rgba(15, 76, 92, 0.1);
            color: var(--color-primary);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: var(--spacing-sm);
        }

        .loop-container { position: relative; margin-top: var(--spacing-lg); }
        .loop-steps {
            display: flex;
            flex-wrap: wrap;
            justify-content: center;
            gap: var(--spacing-md);
            counter-reset: step;
        }
        .step {
            flex: 1;
            min-width: 200px;
            text-align: center;
            position: relative;
            background: var(--color-surface);
            padding: var(--spacing-md);
            border-radius: var(--radius-md);
            border: 1px solid var(--color-border);
            z-index: 2;
        }
        .step h3 { color: var(--color-accent); margin-top: 0.5rem; }
        @media(min-width: 900px) {
            .loop-steps::before {
                content: '';
                position: absolute;
                top: 50%;
                left: 10%;
                right: 10%;
                height: 2px;
                background: repeating-linear-gradient(to right, var(--color-border) 0, var(--color-border) 10px, transparent 10px, transparent 20px);
                z-index: 1;
                transform: translateY(-50%);
            }
        }

        .app-teaser {
            background-color: #2D3748;
            color: white;
            border-radius: var(--radius-lg);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        @media(min-width: 768px) {
            .app-teaser { flex-direction: row; align-items: center; }
        }
        .app-content { padding: var(--spacing-lg); flex: 1; }
        .app-visual {
            flex: 1;
            background-color: #1A202C;
            min-height: 300px;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
        }
        .app-visual img {
            border-radius: var(--radius-sm);
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
            width: 90%;
            border: 1px solid rgba(255,255,255,0.1);
        }

        footer {
            background-color: var(--color-bg);
            border-top: 1px solid var(--color-border);
            padding: var(--spacing-lg) 0;
            margin-top: var(--spacing-xl);
            text-align: center;
            color: var(--color-text-muted);
        }

        .fade-in {
            transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        }
        .fade-in.animate-hidden {
            opacity: 0;
            transform: translateY(20px);
        }

        #waitlist-message { margin-top: 1rem; font-weight: 500; }
        #waitlist-message.success { color: #38A169; }
        #waitlist-message.error { color: #E53E3E; }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <nav>
                <a href="#" class="logo">
                    <img src="https://pub-12f6d303b8dc4698be2adb7d80986978.r2.dev/logo.png" alt="FlowCraft" height="16">
                </a>
                <div class="nav-links">
                    <a href="#story">The Story</a>
                    <a href="#framework">The Framework</a>
                    <a href="#app">The App</a>
                    <a href="#waitlist" class="btn btn-primary" style="padding: 0.5rem 1.25rem; font-size: 0.9rem;">Join Waitlist</a>
                </div>
            </nav>
        </div>
    </header>

    <main>
        <section class="hero">
            <div class="container text-center fade-in">
                <h1 class="mb-md">No one taught you how to find your focus.</h1>
                <p class="lead" style="max-width: 700px; margin: 0 auto 2rem;">
                    Every productivity system you've tried promises to get you into flow consistently. And none of them reliably do. It's time to stop fixing yourself and start designing for your brain.
                </p>
                <div id="waitlist" style="scroll-margin-top: 100px;">
                    <form id="waitlist-form" class="input-group">
                        <input type="email" id="waitlist-email" placeholder="Enter your email address" required aria-label="Email Address">
                        <button type="submit" class="btn btn-primary">Join the Waitlist</button>
                    </form>
                    <div id="waitlist-message"></div>
                    <p style="font-size: 0.875rem; color: var(--color-text-muted); margin-top: 1rem;">
                        Get notified about the next group coaching session + exclusive app access.
                    </p>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="container">
                <div class="quote-box fade-in">
                    <p>"You try the system, it works for a few days, maybe a week, and then it falls apart. Is it the system? Or is it me?"</p>
                    <span>The Maddening Part</span>
                </div>
            </div>
        </section>

        <section id="story" class="section">
            <div class="container">
                <div class="grid grid-2">
                    <div class="fade-in">
                        <h2>I didn't have a name for it yet.</h2>
                        <p>If you had walked past the right grassy area in community college, you might have spotted me — backpack on the ground, juggling balls in the air, completely in my own world.</p>
                        <p>I thought I was just being weird. But if I didn't move my body and do something that demanded my full attention, I couldn't sit still and focus when I got back to class.</p>
                        <p><strong>I was spiking my dopamine.</strong> Moving my body boosts the neurotransmitters my ADHD brain was starving for. And juggling? It demands complete attention. There is no room for mental noise when you're trying to keep three balls in the air.</p>
                        <p class="serif">"I was already doing FlowCraft. I just didn't have a name for it yet."</p>
                    </div>
                    <div class="story-img fade-in">
                        <img src="https://pub-12f6d303b8dc4698be2adb7d80986978.r2.dev/Unicycle3.jpg" alt="Abstract representation of movement and focus" loading="lazy">
                    </div>
                </div>
            </div>
        </section>

        <section class="section" style="background-color: #fff;">
            <div class="container">
                <div class="grid grid-2">
                    <div class="story-img fade-in" style="order: 2;">
                        <img src="https://pub-12f6d303b8dc4698be2adb7d80986978.r2.dev/Contact-Juggling-Cropped.jpg" alt="A quiet moment of realization" loading="lazy">
                    </div>
                    <div class="fade-in" style="order: 1;">
                        <h2>It wasn't luck. It was a structure.</h2>
                        <p>Working the afternoon shift at a Starbucks in Tucson, a customer handed me a book: <em>Flow</em> by Mihaly Csikszentmihalyi.</p>
                        <p>He explained that there is a specific state of consciousness where you become completely absorbed in what you're doing. Time distorts. Self-consciousness disappears.</p>
                        <p>It's not random. It has identifiable conditions. You can learn to create them.</p>
                        <p>That planted the idea that focus wasn't something that happened to you — it was something you could learn to find. On purpose.</p>
                    </div>
                </div>
            </div>
        </section>

        <section id="framework" class="section">
            <div class="container text-center mb-lg fade-in">
                <h2>So, what is FlowCraft?</h2>
                <p class="lead" style="max-width: 800px; margin: 0 auto;">
                    FlowCraft is the ongoing practice of designing, testing, and refining the conditions for your own focus.
                </p>
            </div>

            <div class="container grid grid-3 fade-in">
                <div class="card">
                    <div class="icon-box">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
                    </div>
                    <h3>1. Designing</h3>
                    <p>Not following. Not copying. <strong>Designing.</strong> When I rode that unicycle, I was designing a pre-focus ritual for my specific brain. You are not going to find your version of this in a productivity book.</p>
                </div>
                <div class="card">
                    <div class="icon-box">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                    </div>
                    <h3>2. Testing</h3>
                    <p>FlowCraft is empirical. You form a hypothesis — what if I work in shorter bursts? — and then you run the experiment. You're not failing if it doesn't work; you're learning.</p>
                </div>
                <div class="card">
                    <div class="icon-box">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                    </div>
                    <h3>3. Refining</h3>
                    <p>Most systems assume that once you find the right system, you're done. That's not how life works, and it's not how ADHD works. You refine continuously as your life changes.</p>
                </div>
            </div>
        </section>

        <section class="section">
            <div class="container fade-in">
                <h2 class="text-center">The FlowCraft Loop</h2>
                <p class="text-center lead mb-lg">At the heart of FlowCraft is a simple loop.</p>
                
                <div class="loop-container">
                    <div class="loop-steps">
                        <div class="step">
                            <div class="icon-box" style="margin: 0 auto 1rem;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </div>
                            <h3>Observe</h3>
                            <p>Pay attention to when you're focused and when you're not. Gather data about yourself without judgment.</p>
                        </div>
                        <div class="step">
                            <div class="icon-box" style="margin: 0 auto 1rem;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
                            </div>
                            <h3>Experiment</h3>
                            <p>Deliberately introduce changes. New environments, timing, rituals. Treat it like a hypothesis, not a commitment.</p>
                        </div>
                        <div class="step">
                            <div class="icon-box" style="margin: 0 auto 1rem;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
                            </div>
                            <h3>Measure</h3>
                            <p>Track results and the <strong>felt experience</strong>. Did it work? Did time disappear? Both tracks of data are real.</p>
                        </div>
                        <div class="step">
                            <div class="icon-box" style="margin: 0 auto 1rem;">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                            </div>
                            <h3>Adjust</h3>
                            <p>Take what you learned and modify. Keep what works. Drop what doesn't. Then observe again.</p>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <section id="app" class="section">
            <div class="container">
                <div class="app-teaser fade-in">
                    <div class="app-content">
                        <span style="color: var(--color-accent); font-weight: bold; text-transform: uppercase; letter-spacing: 1px; font-size: 0.875rem;">The Tool & The Team</span>
                        <h2 style="color: white; margin-top: 0.5rem;">You don't have to do this alone.</h2>
                        <p style="color: #CBD5E0; margin-bottom: 1.5rem;">
                            FlowCraft is not a system I can hand you, but I can coach you through the process. I've built a webapp to support your practice, and I'm launching a group coaching cohort to guide you through the loop.
                        </p>
                        <ul style="list-style: none; margin-bottom: 2rem; color: #CBD5E0;">
                            <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 10px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E36414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                Exclusive access to the FlowCraft Webapp
                            </li>
                            <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 10px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E36414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                Group coaching sessions
                            </li>
                            <li style="margin-bottom: 0.5rem; display: flex; align-items: center; gap: 10px;">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E36414" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                A community of ADHD knowledge workers
                            </li>
                        </ul>
                        <a href="#waitlist" class="btn btn-primary">Join the Waitlist</a>
                        <div style="margin-top: 1rem;">
                            <a href="https://adhd-productivity.portercoaching.workers.dev/" target="_blank" style="color: white; text-decoration: underline; font-size: 0.9rem;">Or preview the Webapp demo &rarr;</a>
                        </div>
                    </div>
                    <div class="app-visual">
                        <img src="https://picsum.photos/seed/appui/800/600" alt="FlowCraft Webapp Interface Preview">
                    </div>
                </div>
            </div>
        </section>

        <section class="section text-center">
            <div class="container fade-in" style="max-width: 800px;">
                <h2>A Shift in the Question</h2>
                <p class="lead mb-md">Most of us with ADHD have spent years asking:</p>
                <p class="serif" style="font-size: 1.5rem; margin-bottom: 2rem;">"Why can't I just do what other people seem to do?"</p>
                <p class="lead mb-md">FlowCraft asks a different question:</p>
                <div class="card" style="border-left: 4px solid var(--color-accent);">
                    <p class="serif" style="font-size: 1.5rem; margin-bottom: 0; color: var(--color-primary-dark);">"What conditions make it more possible for my brain to function well?"</p>
                </div>
                <p style="margin-top: 2rem;">
                    You're not measuring yourself against a neurotypical standard. You're trying to understand a system. <strong>Your system.</strong>
                </p>
            </div>
        </section>

        <section class="section" style="background-color: #F0F4F8;">
            <div class="container text-center fade-in">
                <h2 class="mb-md">Ready to find your flow?</h2>
                <p class="lead mb-lg">Join the waitlist to be the first to know when coaching enrollment opens.</p>
                <form class="input-group" onsubmit="event.preventDefault(); document.getElementById('waitlist-email').value && document.getElementById('waitlist-form').dispatchEvent(new Event('submit', {cancelable: true}));">
                    <input type="email" placeholder="Enter your email address" required aria-label="Email Address" form="waitlist-form">
                    <button type="submit" class="btn btn-primary" form="waitlist-form">Get Early Access</button>
                </form>
            </div>
        </section>
    </main>

    <footer>
        <div class="container">
            <div class="logo" style="justify-content: center; margin-bottom: 1rem;">
                <img src="https://pub-12f6d303b8dc4698be2adb7d80986978.r2.dev/logo.png" alt="FlowCraft" height="14">
            </div>
            <p>&copy; 2023 FlowCraft. All rights reserved.</p>
            <p style="font-size: 0.875rem;">
                <a href="#">Privacy Policy</a> &middot; <a href="#">Terms of Service</a>
            </p>
        </div>
    </footer>

    <script>
        document.addEventListener('DOMContentLoaded', () => {
            // Mark below-fold elements as hidden so they can animate in on scroll.
            // Above-fold elements are left visible immediately.
            const belowFold = [];
            document.querySelectorAll('.fade-in').forEach(el => {
                const rect = el.getBoundingClientRect();
                if (rect.top > window.innerHeight) {
                    el.classList.add('animate-hidden');
                    belowFold.push(el);
                }
            });

            const observerOptions = { threshold: 0.1, rootMargin: "0px 0px -50px 0px" };
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.remove('animate-hidden');
                        observer.unobserve(entry.target);
                    }
                });
            }, observerOptions);
            belowFold.forEach(el => observer.observe(el));

            const form = document.getElementById('waitlist-form');
            const messageEl = document.getElementById('waitlist-message');

            // Capture UTM parameters from URL
            function getUTMParams() {
                const params = new URLSearchParams(window.location.search);
                const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
                const utm = {};
                utmKeys.forEach(key => {
                    if (params.has(key)) {
                        utm[key] = params.get(key);
                    }
                });
                // Capture video variant if present
                if (params.has('video')) {
                    utm.video = params.get('video');
                }
                return Object.keys(utm).length > 0 ? utm : null;
            }

            if (form) {
                form.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const email = document.getElementById('waitlist-email').value;
                    const utm = getUTMParams();
                    messageEl.textContent = 'Submitting...';
                    messageEl.className = '';

                    try {
                        const res = await fetch('/api/waitlist', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, utm })
                        });
                        const data = await res.json();

                        if (res.ok) {
                            window.location.href = '/thank-you';
                        } else {
                            messageEl.textContent = data.error || 'Something went wrong. Please try again.';
                            messageEl.className = 'error';
                        }
                    } catch (err) {
                        messageEl.textContent = 'Network error. Please try again.';
                        messageEl.className = 'error';
                    }
                });
            }
        });
    </script>
</body>
</html>`;
}

// Get Admin Dashboard HTML
function getAdminHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FlowCraft Admin - Waitlist Management</title>
    <style>
        :root {
            --color-bg: #F9FAFB;
            --color-surface: #FFFFFF;
            --color-primary: #0F4C5C;
            --color-primary-dark: #09303b;
            --color-accent: #FF9A2F;
            --color-accent-hover: #F08020;
            --color-text-main: #2D3748;
            --color-text-muted: #718096;
            --color-border: #E2E8F0;
            --color-success: #38A169;
            --color-danger: #E53E3E;
            --spacing-xs: 0.5rem;
            --spacing-sm: 1rem;
            --spacing-md: 2rem;
            --spacing-lg: 4rem;
            --radius-sm: 4px;
            --radius-md: 8px;
            --radius-lg: 16px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
            --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--color-bg);
            color: var(--color-text-main);
            line-height: 1.6;
        }
        .container { max-width: 1400px; margin: 0 auto; padding: var(--spacing-md); }
        
        /* Login */
        .login-container {
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .login-box {
            background: var(--color-surface);
            padding: var(--spacing-lg);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-md);
            width: 100%;
            max-width: 400px;
        }
        .login-box h1 { text-align: center; margin-bottom: var(--spacing-md); color: var(--color-primary-dark); }
        
        /* Header */
        .admin-header {
            background: var(--color-surface);
            border-bottom: 1px solid var(--color-border);
            padding: var(--spacing-sm) 0;
            margin-bottom: var(--spacing-md);
        }
        .header-content {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header-content h1 { color: var(--color-primary-dark); margin: 0; }
        
        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 0.625rem 1.25rem;
            border-radius: var(--radius-md);
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            font-size: 0.875rem;
        }
        .btn-primary { background: var(--color-accent); color: white; }
        .btn-primary:hover { background: var(--color-accent-hover); }
        .btn-secondary { background: var(--color-primary); color: white; }
        .btn-secondary:hover { background: var(--color-primary-dark); }
        .btn-outline { background: transparent; border: 1px solid var(--color-border); color: var(--color-text-main); }
        .btn-outline:hover { background: var(--color-bg); }
        .btn-danger { background: var(--color-danger); color: white; }
        .btn-danger:hover { opacity: 0.9; }
        .btn-sm { padding: 0.375rem 0.75rem; font-size: 0.75rem; }
        
        /* Inputs */
        input, select {
            padding: 0.625rem;
            border: 1px solid var(--color-border);
            border-radius: var(--radius-md);
            font-size: 0.875rem;
        }
        input:focus, select:focus { outline: none; border-color: var(--color-primary); }
        
        /* Stats */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-md);
        }
        .stat-card {
            background: var(--color-surface);
            padding: var(--spacing-sm);
            border-radius: var(--radius-md);
            border: 1px solid var(--color-border);
        }
        .stat-card h3 { font-size: 0.75rem; color: var(--color-text-muted); text-transform: uppercase; margin-bottom: 0.25rem; }
        .stat-card .value { font-size: 2rem; font-weight: 700; color: var(--color-primary-dark); }
        
        /* Filters */
        .filters {
            background: var(--color-surface);
            padding: var(--spacing-sm);
            border-radius: var(--radius-md);
            border: 1px solid var(--color-border);
            margin-bottom: var(--spacing-sm);
            display: flex;
            flex-wrap: wrap;
            gap: var(--spacing-xs);
            align-items: center;
        }
        .filters input, .filters select { flex: 1; min-width: 150px; }
        
        /* Table */
        .table-container {
            background: var(--color-surface);
            border-radius: var(--radius-md);
            border: 1px solid var(--color-border);
            overflow: hidden;
        }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--color-border); }
        th { background: var(--color-bg); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-muted); }
        tr:hover { background: var(--color-bg); }
        tr.selected { background: rgba(15, 76, 92, 0.05); }
        
        /* Tags */
        .tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 0.25rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
            color: white;
        }
        .tag-remove {
            cursor: pointer;
            opacity: 0.7;
            margin-left: 4px;
        }
        .tag-remove:hover { opacity: 1; }
        .tag-selector {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-top: 0.5rem;
        }
        
        /* Modal */
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        .modal.active { display: flex; }
        .modal-content {
            background: var(--color-surface);
            padding: var(--spacing-md);
            border-radius: var(--radius-lg);
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        }
        .modal-content h2 { margin-bottom: var(--spacing-sm); }
        
        /* Tabs */
        .tabs { display: flex; gap: var(--spacing-xs); margin-bottom: var(--spacing-sm); border-bottom: 1px solid var(--color-border); }
        .tab {
            padding: 0.75rem 1.25rem;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            font-weight: 500;
        }
        .tab.active { border-bottom-color: var(--color-accent); color: var(--color-accent); }
        .tab:hover { color: var(--color-primary); }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        /* Export logs */
        .log-item {
            padding: var(--spacing-sm);
            border-bottom: 1px solid var(--color-border);
        }
        .log-item:last-child { border-bottom: none; }
        
        /* Pagination */
        .pagination {
            display: flex;
            justify-content: center;
            gap: var(--spacing-xs);
            margin-top: var(--spacing-sm);
        }
        .pagination button {
            padding: 0.5rem 1rem;
            border: 1px solid var(--color-border);
            background: var(--color-surface);
            cursor: pointer;
            border-radius: var(--radius-sm);
        }
        .pagination button:disabled { opacity: 0.5; cursor: not-allowed; }
        .pagination button.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
        
        /* Toast */
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--color-primary-dark);
            color: white;
            padding: 1rem 1.5rem;
            border-radius: var(--radius-md);
            box-shadow: var(--shadow-md);
            z-index: 2000;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s;
        }
        .toast.show { transform: translateY(0); opacity: 1; }
        
        /* Checkbox */
        .checkbox { width: 18px; height: 18px; cursor: pointer; }
        
        /* Bulk actions */
        .bulk-actions {
            display: none;
            background: var(--color-primary-dark);
            color: white;
            padding: 0.75rem 1rem;
            border-radius: var(--radius-md);
            margin-bottom: var(--spacing-sm);
            align-items: center;
            gap: var(--spacing-sm);
        }
        .bulk-actions.show { display: flex; }
        .bulk-actions .btn { background: rgba(255,255,255,0.2); color: white; border: none; }
        .bulk-actions .btn:hover { background: rgba(255,255,255,0.3); }
        
        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div id="app">
        <!-- Login Screen -->
        <div id="login-screen" class="login-container">
            <div class="login-box">
                <h1>🔐 FlowCraft Admin</h1>
                <form id="login-form">
                    <div style="margin-bottom: 1rem;">
                        <label style="display: block; margin-bottom: 0.5rem; font-weight: 500;">Password</label>
                        <input type="password" id="login-password" placeholder="Enter admin password" style="width: 100%;">
                    </div>
                    <button type="submit" class="btn btn-primary" style="width: 100%;">Login</button>
                    <p id="login-error" style="color: var(--color-danger); margin-top: 1rem; display: none;"></p>
                </form>
            </div>
        </div>

        <!-- Dashboard -->
        <div id="dashboard" class="hidden">
            <header class="admin-header">
                <div class="container header-content">
                    <h1>📊 FlowCraft Waitlist Admin</h1>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-outline" onclick="showTab('emails')">Emails</button>
                        <button class="btn btn-outline" onclick="showTab('exports')">Export Logs</button>
                        <button class="btn btn-outline" onclick="showTab('tags')">Manage Tags</button>
                        <button class="btn btn-outline" onclick="showTab('email-templates')">✉️ Email Templates</button>
                        <button class="btn btn-outline" onclick="showTab('help')">📖 Tracking Guide</button>
                        <button class="btn btn-danger" onclick="logout()">Logout</button>
                    </div>
                </div>
            </header>

            <div class="container">
                <!-- Stats -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>Total Signups</h3>
                        <div class="value" id="stat-total">-</div>
                    </div>
                    <div class="stat-card">
                        <h3>This Week</h3>
                        <div class="value" id="stat-week">-</div>
                    </div>
                    <div class="stat-card">
                        <h3>This Month</h3>
                        <div class="value" id="stat-month">-</div>
                    </div>
                    <div class="stat-card">
                        <h3>Total Exports</h3>
                        <div class="value" id="stat-exports">-</div>
                    </div>
                </div>

                <!-- Emails Tab -->
                <div id="tab-emails" class="tab-content active">
                    <div class="filters">
                        <input type="text" id="filter-search" placeholder="Search emails...">
                        <select id="filter-tag">
                            <option value="">All Tags</option>
                        </select>
                        <select id="filter-utm-source">
                            <option value="">All Sources</option>
                        </select>
                        <input type="date" id="filter-date-from" placeholder="From">
                        <input type="date" id="filter-date-to" placeholder="To">
                        <button class="btn btn-secondary" onclick="loadEmails()">Filter</button>
                        <button class="btn btn-outline" onclick="clearFilters()">Clear</button>
                    </div>

                    <div class="bulk-actions" id="bulk-actions">
                        <span id="selected-count">0 selected</span>
                        <button class="btn" onclick="openBulkTagModal()">Add Tags</button>
                        <button class="btn" onclick="exportSelected()">Export Selected</button>
                        <button class="btn" onclick="clearSelection()">Clear Selection</button>
                    </div>

                    <div style="margin-bottom: 1rem; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <button class="btn btn-primary" onclick="exportCurrent()">📥 Export Current View</button>
                            <button class="btn btn-outline" onclick="openExportModal()">📤 Export with Filters</button>
                        </div>
                        <span id="showing-text">Showing 0 of 0</span>
                    </div>

                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th style="width: 40px;"><input type="checkbox" class="checkbox" id="select-all" onchange="toggleSelectAll()"></th>
                                    <th>Email</th>
                                    <th>Tags</th>
                                    <th>Source / UTM</th>
                                    <th>Signup Date</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="emails-table-body">
                            </tbody>
                        </table>
                    </div>

                    <div class="pagination" id="pagination"></div>
                </div>

                <!-- Export Logs Tab -->
                <div id="tab-exports" class="tab-content">
                    <h2 style="margin-bottom: 1rem;">Export History</h2>
                    <div class="table-container">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Count</th>
                                    <th>Filter: Tag</th>
                                    <th>Filter: Date Range</th>
                                </tr>
                            </thead>
                            <tbody id="exports-table-body">
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Tags Tab -->
                <div id="tab-tags" class="tab-content">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
                        <div>
                            <h2 style="margin-bottom: 1rem;">Create New Tag</h2>
                            <form id="create-tag-form" style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                                <div style="margin-bottom: 1rem;">
                                    <label style="display: block; margin-bottom: 0.5rem;">Tag Name</label>
                                    <input type="text" id="new-tag-name" placeholder="e.g., cohort-2" style="width: 100%;" required>
                                </div>
                                <div style="margin-bottom: 1rem;">
                                    <label style="display: block; margin-bottom: 0.5rem;">Color</label>
                                    <input type="color" id="new-tag-color" value="#0F4C5C" style="width: 60px; height: 40px; padding: 0;">
                                </div>
                                <button type="submit" class="btn btn-primary">Create Tag</button>
                            </form>
                        </div>
                        <div>
                            <h2 style="margin-bottom: 1rem;">Existing Tags</h2>
                            <div id="tags-list" style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Help / Tracking Guide Tab -->
                <div id="tab-help" class="tab-content">
                    <div style="max-width: 900px;">
                        <h2 style="margin-bottom: 0.5rem;">📖 UTM Tracking Guide</h2>
                        <p style="color: var(--color-text-muted); margin-bottom: 2rem;">Learn how to track where your signups come from using URL parameters.</p>

                        <!-- What are UTM Parameters -->
                        <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
                            <h3 style="color: var(--color-primary-dark); margin-bottom: 0.75rem;">What are UTM Parameters?</h3>
                            <p style="margin-bottom: 1rem;">UTM parameters are tags you add to your URLs to track where traffic comes from. When someone clicks a link with these parameters and signs up, the tracking data is automatically saved with their email.</p>
                            
                            <div style="background: var(--color-bg); padding: 1rem; border-radius: 6px; border-left: 4px solid var(--color-accent);">
                                <p style="font-family: monospace; font-size: 0.875rem; margin: 0; word-break: break-all;">
                                    https://flowcraft-website.portercoaching.workers.dev/<br>
                                    <span style="color: var(--color-text-muted);">?utm_source=youtube</span><span style="color: var(--color-accent);">&utm_medium=video</span><span style="color: #805AD5;">&utm_campaign=video1-launch</span><span style="color: #D69E2E;">&video=1</span>
                                </p>
                            </div>
                        </div>

                        <!-- Parameter Reference -->
                        <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
                            <h3 style="color: var(--color-primary-dark); margin-bottom: 1rem;">Parameter Reference</h3>
                            
                            <table style="width: 100%; border-collapse: collapse;">
                                <thead>
                                    <tr style="border-bottom: 2px solid var(--color-border);">
                                        <th style="text-align: left; padding: 0.75rem 0.5rem;">Parameter</th>
                                        <th style="text-align: left; padding: 0.75rem 0.5rem;">Purpose</th>
                                        <th style="text-align: left; padding: 0.75rem 0.5rem;">Example Values</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr style="border-bottom: 1px solid var(--color-border);">
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">utm_source</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">Where the traffic comes from</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">youtube, twitter, google, newsletter, tiktok, instagram</code></td>
                                    </tr>
                                    <tr style="border-bottom: 1px solid var(--color-border);">
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">utm_medium</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">The marketing channel type</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">video, social, email, organic, paid, cpc</code></td>
                                    </tr>
                                    <tr style="border-bottom: 1px solid var(--color-border);">
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">utm_campaign</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">The specific campaign name</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">video1-launch, summer-promo, adhd-month</code></td>
                                    </tr>
                                    <tr style="border-bottom: 1px solid var(--color-border);">
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">utm_content</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">Differentiate similar content</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">banner, text-link, thumbnail-a, thumbnail-b</code></td>
                                    </tr>
                                    <tr style="border-bottom: 1px solid var(--color-border);">
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">utm_term</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">Paid search keywords</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">adhd+focus, productivity+app</code></td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="background: var(--color-bg); padding: 2px 6px; border-radius: 4px; font-size: 0.8rem;">video</code></td>
                                        <td style="padding: 0.75rem 0.5rem;">Video variant number</td>
                                        <td style="padding: 0.75rem 0.5rem;"><code style="font-size: 0.8rem;">1, 2, 3, etc.</code></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Quick URL Builder -->
                        <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
                            <h3 style="color: var(--color-primary-dark); margin-bottom: 0.75rem;">🔗 Quick URL Builder</h3>
                            <p style="color: var(--color-text-muted); margin-bottom: 1rem;">Fill in the fields below to generate a tracking URL.</p>
                            
                            <div style="display: grid; gap: 0.75rem;">
                                <div>
                                    <label style="display: block; margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 500;">Video Number</label>
                                    <input type="number" id="help-video" placeholder="e.g., 1" min="1" style="width: 100%; max-width: 150px;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 500;">Source (utm_source)</label>
                                    <input type="text" id="help-source" placeholder="e.g., youtube" style="width: 100%;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 500;">Medium (utm_medium)</label>
                                    <input type="text" id="help-medium" placeholder="e.g., video" style="width: 100%;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 0.25rem; font-size: 0.875rem; font-weight: 500;">Campaign (utm_campaign)</label>
                                    <input type="text" id="help-campaign" placeholder="e.g., video1-launch" style="width: 100%;">
                                </div>
                            </div>
                            
                            <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center;">
                                <button class="btn btn-primary" onclick="generateTrackingUrl()">Generate URL</button>
                                <button class="btn btn-outline" onclick="copyGeneratedUrl()">Copy URL</button>
                            </div>
                            
                            <div id="generated-url" style="margin-top: 1rem; padding: 1rem; background: var(--color-bg); border-radius: 6px; display: none;">
                                <p style="font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0;" id="generated-url-text"></p>
                            </div>
                        </div>

                        <!-- Example URLs -->
                        <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border); margin-bottom: 1.5rem;">
                            <h3 style="color: var(--color-primary-dark); margin-bottom: 0.75rem;">Example Tracking URLs</h3>
                            <div style="display: grid; gap: 0.75rem;">
                                <div style="padding: 0.75rem; background: var(--color-bg); border-radius: 6px;">
                                    <p style="font-weight: 500; margin-bottom: 0.25rem;">YouTube Video 1</p>
                                    <p style="font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0; color: var(--color-text-muted);">
                                        ?utm_source=youtube&utm_medium=video&utm_campaign=video1&video=1
                                    </p>
                                </div>
                                <div style="padding: 0.75rem; background: var(--color-bg); border-radius: 6px;">
                                    <p style="font-weight: 500; margin-bottom: 0.25rem;">Twitter Post</p>
                                    <p style="font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0; color: var(--color-text-muted);">
                                        ?utm_source=twitter&utm_medium=social&utm_campaign=launch-announcement
                                    </p>
                                </div>
                                <div style="padding: 0.75rem; background: var(--color-bg); border-radius: 6px;">
                                    <p style="font-weight: 500; margin-bottom: 0.25rem;">Email Newsletter</p>
                                    <p style="font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0; color: var(--color-text-muted);">
                                        ?utm_source=newsletter&utm_medium=email&utm_campaign=april-2024
                                    </p>
                                </div>
                                <div style="padding: 0.75rem; background: var(--color-bg); border-radius: 6px;">
                                    <p style="font-weight: 500; margin-bottom: 0.25rem;">Google Ads</p>
                                    <p style="font-family: monospace; font-size: 0.8rem; word-break: break-all; margin: 0; color: var(--color-text-muted);">
                                        ?utm_source=google&utm_medium=paid&utm_campaign=adhd-awareness&utm_term=adhd+productivity
                                    </p>
                                </div>
                            </div>
                        </div>

                        <!-- How to View Data -->
                        <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                            <h3 style="color: var(--color-primary-dark); margin-bottom: 0.75rem;">📊 Viewing Tracking Data</h3>
                            <ul style="margin-left: 1.5rem; line-height: 2;">
                                <li><strong>Emails Tab:</strong> The "Source / UTM" column shows colored badges for each tracked parameter.</li>
                                <li><strong>Filter by Source:</strong> Use the "All Sources" dropdown in the filters bar to see signups from a specific source.</li>
                                <li><strong>Export with UTM Data:</strong> All CSV exports include UTM Source, UTM Campaign, and Video columns.</li>
                                <li><strong>Export Logs:</strong> See when exports happened and what filters were used.</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- Email Templates Tab -->
                <div id="tab-email-templates" class="tab-content">
                    <div style="max-width: 1200px;">
                        <h2 style="margin-bottom: 0.5rem;">✉️ Email Templates</h2>
                        <p style="color: var(--color-text-muted); margin-bottom: 2rem;">Customize the welcome email that new waitlist signups receive. Supports markdown formatting.</p>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                            <!-- Editor Panel -->
                            <div>
                                <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
                                        <h3 style="margin: 0;">Editor</h3>
                                        <div style="display: flex; gap: 0.5rem;">
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('# ', 'Heading 1')" title="Heading 1">H1</button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('## ', 'Heading 2')" title="Heading 2">H2</button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('**', 'bold text**')" title="Bold"><strong>B</strong></button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('*', 'italic text*')" title="Italic"><em>I</em></button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('> ', 'quote')" title="Quote">"</button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('- ', 'list item')" title="List">•</button>
                                            <button class="btn btn-sm btn-outline" onclick="insertMarkdown('---\n', '')" title="Divider">—</button>
                                        </div>
                                    </div>

                                    <div style="margin-bottom: 1rem;">
                                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500;">Email Subject</label>
                                        <input type="text" id="template-subject" placeholder="You're on the FlowCraft Waitlist! 🎯" style="width: 100%;">
                                    </div>

                                    <div style="margin-bottom: 1rem;">
                                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500;">Template Name</label>
                                        <input type="text" id="template-name" value="Welcome Email" style="width: 100%;" readonly>
                                    </div>

                                    <div style="margin-bottom: 1rem;">
                                        <label style="display: block; margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 500;">
                                            Email Body (Markdown)
                                            <span style="color: var(--color-text-muted); font-weight: 400; font-size: 0.75rem;">— supports # headings, **bold**, *italic*, > quotes, - lists, --- dividers</span>
                                        </label>
                                        <textarea id="template-body" style="width: 100%; min-height: 400px; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: 13px; line-height: 1.6; padding: 12px; border: 1px solid var(--color-border); border-radius: 6px; resize: vertical;" placeholder="# Welcome!

Thanks for joining..."></textarea>
                                    </div>

                                    <div style="display: flex; gap: 0.5rem;">
                                        <button class="btn btn-primary" onclick="saveEmailTemplate()">💾 Save Template</button>
                                        <button class="btn btn-outline" onclick="previewEmailTemplate()">👁️ Preview</button>
                                        <button class="btn btn-outline" onclick="loadEmailTemplate()">🔄 Reset</button>
                                    </div>
                                </div>
                            </div>

                            <!-- Preview Panel -->
                            <div>
                                <div style="background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                                    <h3 style="margin: 0 0 1rem;">Live Preview</h3>
                                    
                                    <div style="background: #F9FAFB; border-radius: 8px; padding: 20px; min-height: 400px; border: 1px solid var(--color-border);">
                                        <div style="max-width: 400px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                                            <div id="template-preview" style="font-size: 14px; line-height: 1.6;">
                                                <p style="color: var(--color-text-muted); text-align: center; padding: 40px 0;">Click "Preview" to see how your email will look</p>
                                            </div>
                                            <div style="text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0;">
                                                <p style="color: #718096; font-size: 12px; margin: 0;">— The FlowCraft Team</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Saved Templates -->
                        <div style="margin-top: 2rem; background: var(--color-surface); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--color-border);">
                            <h3 style="margin: 0 0 1rem;">Saved Templates</h3>
                            <div id="templates-list" style="display: grid; gap: 0.75rem;">
                                <p style="color: var(--color-text-muted); text-align: center; padding: 1rem;">Loading templates...</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Export Modal -->
    <div class="modal" id="export-modal">
        <div class="modal-content">
            <h2>Export Emails</h2>
            <p style="color: var(--color-text-muted); margin-bottom: 1rem;">Choose filters for export. Leave blank to export all.</p>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Filter by Tag</label>
                <select id="export-tag" style="width: 100%;">
                    <option value="">All Tags</option>
                </select>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                <div>
                    <label style="display: block; margin-bottom: 0.5rem;">From Date</label>
                    <input type="date" id="export-date-from" style="width: 100%;">
                </div>
                <div>
                    <label style="display: block; margin-bottom: 0.5rem;">To Date</label>
                    <input type="date" id="export-date-to" style="width: 100%;">
                </div>
            </div>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-outline" onclick="closeExportModal()">Cancel</button>
                <button class="btn btn-primary" onclick="doExport()">Export CSV</button>
            </div>
        </div>
    </div>

    <!-- Bulk Tag Modal -->
    <div class="modal" id="bulk-tag-modal">
        <div class="modal-content">
            <h2>Add Tags to Selected</h2>
            <div style="margin-bottom: 1rem;">
                <label style="display: block; margin-bottom: 0.5rem;">Select Tags</label>
                <div id="bulk-tag-options" class="tag-selector"></div>
            </div>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                <button class="btn btn-outline" onclick="closeBulkTagModal()">Cancel</button>
                <button class="btn btn-primary" onclick="applyBulkTags()">Apply Tags</button>
            </div>
        </div>
    </div>

    <!-- Toast -->
    <div class="toast" id="toast"></div>

    <script>
        let currentPage = 1;
        let selectedEmails = new Set();
        let allTags = [];

        // Check auth on load
        async function checkAuth() {
            try {
                const res = await fetch('/api/admin/verify');
                const data = await res.json();
                if (data.authenticated) {
                    showDashboard();
                }
            } catch (e) {}
        }

        // Login
        document.getElementById('login-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('login-password').value;
            const errorEl = document.getElementById('login-error');
            
            try {
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                
                if (res.ok) {
                    showDashboard();
                } else {
                    errorEl.textContent = data.error;
                    errorEl.style.display = 'block';
                }
            } catch (e) {
                errorEl.textContent = 'Network error';
                errorEl.style.display = 'block';
            }
        });

        function showDashboard() {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('dashboard').classList.remove('hidden');
            loadAll();
        }

        async function logout() {
            await fetch('/api/admin/logout', { method: 'POST' });
            location.reload();
        }

        async function loadAll() {
            await Promise.all([loadStats(), loadEmails(), loadTags(), loadExportLogs()]);
        }

        async function loadStats() {
            const res = await fetch('/api/waitlist?page=1&limit=1');
            const data = await res.json();
            document.getElementById('stat-total').textContent = data.total;
            
            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            const weekRes = await fetch(\`/api/waitlist?dateFrom=\${weekAgo}&page=1&limit=1\`);
            const weekData = await weekRes.json();
            document.getElementById('stat-week').textContent = weekData.total;
            
            const monthRes = await fetch(\`/api/waitlist?dateFrom=\${monthAgo}&page=1&limit=1\`);
            const monthData = await monthRes.json();
            document.getElementById('stat-month').textContent = monthData.total;
            
            const exportRes = await fetch('/api/export-logs');
            const exportData = await exportRes.json();
            document.getElementById('stat-exports').textContent = exportData.logs.length;
        }

        async function loadEmails() {
            const search = document.getElementById('filter-search').value;
            const tag = document.getElementById('filter-tag').value;
            const utmSource = document.getElementById('filter-utm-source').value;
            const dateFrom = document.getElementById('filter-date-from').value;
            const dateTo = document.getElementById('filter-date-to').value;
            
            let url = \`/api/waitlist?page=\${currentPage}&limit=50\`;
            if (search) url += \`&search=\${search}\`;
            if (tag) url += \`&tag=\${tag}\`;
            if (utmSource) url += \`&utmSource=\${utmSource}\`;
            if (dateFrom) url += \`&dateFrom=\${dateFrom}\`;
            if (dateTo) url += \`&dateTo=\${dateTo}\`;
            
            const res = await fetch(url);
            const data = await res.json();
            
            const tbody = document.getElementById('emails-table-body');
            tbody.innerHTML = data.emails.map(email => {
                const utm = email.utm_data ? JSON.parse(email.utm_data) : {};
                const utmBadges = [];
                if (utm.utm_source) utmBadges.push(\`<span class="tag" style="background: #38A169;">\${utm.utm_source}</span>\`);
                if (utm.utm_campaign) utmBadges.push(\`<span class="tag" style="background: #805AD5;">\${utm.utm_campaign}</span>\`);
                if (utm.video) utmBadges.push(\`<span class="tag" style="background: #D69E2E;">Video \${utm.video}</span>\`);

                return \`
                <tr class="\${selectedEmails.has(email.id) ? 'selected' : ''}">
                    <td><input type="checkbox" class="checkbox" \${selectedEmails.has(email.id) ? 'checked' : ''} onchange="toggleEmail('\${email.id}')"></td>
                    <td>\${email.email}</td>
                    <td>
                        \${email.tags.map(t => \`<span class="tag" style="background: \${t.color}">\${t.name}<span class="tag-remove" onclick="removeTag('\${email.id}', '\${t.name}')">&times;</span></span>\`).join(' ')}
                        <button class="btn btn-sm btn-outline" onclick="openTagModal('\${email.id}')" style="margin-left: 4px;">+</button>
                    </td>
                    <td>\${utmBadges.length > 0 ? utmBadges.join(' ') : '<span style="color: var(--color-text-muted);">-</span>'}</td>
                    <td>\${new Date(email.created_at).toLocaleDateString()}</td>
                    <td>
                        <button class="btn btn-sm btn-outline" onclick="copyEmail('\${email.email}')">Copy</button>
                    </td>
                </tr>
                \`;
            }).join('');
            
            document.getElementById('showing-text').textContent = \`Showing \${data.emails.length} of \${data.total}\`;
            
            // Update UTM source filter dropdown
            const utmSourceSelect = document.getElementById('filter-utm-source');
            const currentUtmSource = utmSourceSelect.value;
            if (data.utmSources && data.utmSources.length > 0) {
                utmSourceSelect.innerHTML = '<option value="">All Sources</option>' + 
                    data.utmSources.map(s => \`<option value="\${s}">\${s}</option>\`).join('');
                utmSourceSelect.value = currentUtmSource;
            }
            
            // Pagination
            const pagination = document.getElementById('pagination');
            pagination.innerHTML = '';
            for (let i = 1; i <= data.totalPages; i++) {
                pagination.innerHTML += \`<button class="\${i === currentPage ? 'active' : ''}" onclick="goToPage(\${i})">\${i}</button>\`;
            }
            
            updateBulkActions();
        }

        async function loadTags() {
            const res = await fetch('/api/tags');
            const data = await res.json();
            allTags = data.tags;
            
            // Update filter dropdown
            const filterSelect = document.getElementById('filter-tag');
            const exportSelect = document.getElementById('export-tag');
            const currentFilter = filterSelect.value;
            const currentExport = exportSelect.value;
            
            filterSelect.innerHTML = '<option value="">All Tags</option>' + data.tags.map(t => \`<option value="\${t.name}">\${t.name} (\${t.email_count})</option>\`).join('');
            exportSelect.innerHTML = '<option value="">All Tags</option>' + data.tags.map(t => \`<option value="\${t.name}">\${t.name}</option>\`).join('');
            filterSelect.value = currentFilter;
            exportSelect.value = currentExport;
            
            // Update tags list
            document.getElementById('tags-list').innerHTML = data.tags.map(t => \`
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border);">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="tag" style="background: \${t.color}; font-size: 0.875rem;">\${t.name}</span>
                        <span style="color: var(--color-text-muted); font-size: 0.75rem;">\${t.email_count} emails</span>
                    </div>
                    <button class="btn btn-sm btn-danger" onclick="deleteTag('\${t.id}')">Delete</button>
                </div>
            \`).join('') || '<p style="color: var(--color-text-muted);">No tags yet</p>';
        }

        async function loadExportLogs() {
            const res = await fetch('/api/export-logs');
            const data = await res.json();
            
            document.getElementById('exports-table-body').innerHTML = data.logs.map(log => \`
                <tr>
                    <td>\${new Date(log.exported_at).toLocaleString()}</td>
                    <td>\${log.exported_count}</td>
                    <td>\${log.filter_tags || '-'}</td>
                    <td>\${log.filter_date_from ? new Date(log.filter_date_from).toLocaleDateString() : '-'} to \${log.filter_date_to ? new Date(log.filter_date_to).toLocaleDateString() : '-'}</td>
                </tr>
            \`).join('') || '<tr><td colspan="4" style="text-align: center;">No exports yet</td></tr>';
        }

        function showTab(tab) {
            document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
            document.getElementById(\`tab-\${tab}\`).classList.add('active');

            if (tab === 'exports') loadExportLogs();
            if (tab === 'tags') loadTags();
            if (tab === 'email-templates') loadEmailTemplates();
        }

        // URL Builder functions
        function generateTrackingUrl() {
            const video = document.getElementById('help-video').value;
            const source = document.getElementById('help-source').value;
            const medium = document.getElementById('help-medium').value;
            const campaign = document.getElementById('help-campaign').value;
            
            const baseUrl = 'https://flowcraft-website.portercoaching.workers.dev/';
            const params = [];
            
            if (source) params.push(\`utm_source=\${encodeURIComponent(source)}\`);
            if (medium) params.push(\`utm_medium=\${encodeURIComponent(medium)}\`);
            if (campaign) params.push(\`utm_campaign=\${encodeURIComponent(campaign)}\`);
            if (video) params.push(\`video=\${encodeURIComponent(video)}\`);
            
            const url = params.length > 0 ? baseUrl + '?' + params.join('&') : baseUrl;
            
            document.getElementById('generated-url-text').textContent = url;
            document.getElementById('generated-url').style.display = 'block';
        }

        function copyGeneratedUrl() {
            const urlText = document.getElementById('generated-url-text').textContent;
            if (!urlText) {
                showToast('Generate a URL first!');
                return;
            }
            navigator.clipboard.writeText(urlText);
            showToast('URL copied to clipboard!');
        }

        function clearFilters() {
            document.getElementById('filter-search').value = '';
            document.getElementById('filter-tag').value = '';
            document.getElementById('filter-utm-source').value = '';
            document.getElementById('filter-date-from').value = '';
            document.getElementById('filter-date-to').value = '';
            currentPage = 1;
            loadEmails();
        }

        function goToPage(page) {
            currentPage = page;
            loadEmails();
        }

        function toggleEmail(id) {
            if (selectedEmails.has(id)) {
                selectedEmails.delete(id);
            } else {
                selectedEmails.add(id);
            }
            updateBulkActions();
            loadEmails();
        }

        function toggleSelectAll() {
            const checkboxes = document.querySelectorAll('#emails-table-body .checkbox');
            const allSelected = Array.from(checkboxes).every(cb => cb.checked);
            
            checkboxes.forEach(cb => {
                const emailId = cb.closest('tr').querySelector('button[onclick^="openTagModal"]').getAttribute('onclick').match(/'([^']+)'/)[1];
                if (allSelected) {
                    selectedEmails.delete(emailId);
                } else {
                    selectedEmails.add(emailId);
                }
            });
            
            updateBulkActions();
            loadEmails();
        }

        function updateBulkActions() {
            const bulkActions = document.getElementById('bulk-actions');
            if (selectedEmails.size > 0) {
                bulkActions.classList.add('show');
                document.getElementById('selected-count').textContent = \`\${selectedEmails.size} selected\`;
            } else {
                bulkActions.classList.remove('show');
            }
        }

        function clearSelection() {
            selectedEmails.clear();
            updateBulkActions();
            loadEmails();
        }

        function copyEmail(email) {
            navigator.clipboard.writeText(email);
            showToast('Email copied!');
        }

        async function removeTag(emailId, tagName) {
            const tag = allTags.find(t => t.name === tagName);
            if (!tag) return;
            
            await fetch('/api/email-tags', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailId, tagId: tag.id })
            });
            
            showToast(\`Tag "\${tagName}" removed\`);
            loadAll();
        }

        function openTagModal(emailId) {
            // Simple prompt for now
            const tagName = prompt('Enter tag name:');
            if (!tagName) return;
            
            const tag = allTags.find(t => t.name === tagName);
            if (!tag) {
                showToast('Tag not found. Create it in Manage Tags first.');
                return;
            }
            
            addTagToEmail(emailId, tag.id);
        }

        async function addTagToEmail(emailId, tagId) {
            await fetch('/api/email-tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailId, tagId })
            });
            
            showToast('Tag added!');
            loadAll();
        }

        function openExportModal() {
            document.getElementById('export-modal').classList.add('active');
        }

        function closeExportModal() {
            document.getElementById('export-modal').classList.remove('active');
        }

        async function doExport() {
            const tag = document.getElementById('export-tag').value;
            const dateFrom = document.getElementById('export-date-from').value;
            const dateTo = document.getElementById('export-date-to').value;
            
            const res = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag, dateFrom, dateTo })
            });
            
            const data = await res.json();
            
            if (data.emails.length === 0) {
                showToast('No emails to export');
                return;
            }

            // Create CSV with UTM data
            const csv = [
                'Email,Signup Date,Tags,UTM Source,UTM Campaign,Video',
                ...data.emails.map(e => {
                    const utm = e.utm_data ? JSON.parse(e.utm_data) : {};
                    return \`"\${e.email}","\${new Date(e.created_at).toLocaleString()}","\${e.tags.map(t => t.name).join(', ')}","\${utm.utm_source || ''}","\${utm.utm_campaign || ''}","\${utm.video || ''}"\`;
                })
            ].join('\\n');
            
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`flowcraft-waitlist-\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
            URL.revokeObjectURL(url);
            
            closeExportModal();
            showToast(\`Exported \${data.emails.length} emails!\`);
            loadAll();
        }

        async function exportCurrent() {
            const search = document.getElementById('filter-search').value;
            const tag = document.getElementById('filter-tag').value;
            const dateFrom = document.getElementById('filter-date-from').value;
            const dateTo = document.getElementById('filter-date-to').value;
            
            const res = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag, dateFrom, dateTo, search })
            });
            
            const data = await res.json();
            
            if (data.emails.length === 0) {
                showToast('No emails to export');
                return;
            }

            const csv = [
                'Email,Signup Date,Tags,UTM Source,UTM Campaign,Video',
                ...data.emails.map(e => {
                    const utm = e.utm_data ? JSON.parse(e.utm_data) : {};
                    return \`"\${e.email}","\${new Date(e.created_at).toLocaleString()}","\${e.tags.map(t => t.name).join(', ')}","\${utm.utm_source || ''}","\${utm.utm_campaign || ''}","\${utm.video || ''}"\`;
                })
            ].join('\\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`flowcraft-waitlist-\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
            URL.revokeObjectURL(url);

            showToast(\`Exported \${data.emails.length} emails!\`);
            loadAll();
        }

        async function exportSelected() {
            if (selectedEmails.size === 0) return;

            const res = await fetch('/api/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emailIds: Array.from(selectedEmails) })
            });

            const data = await res.json();

            const csv = [
                'Email,Signup Date,Tags,UTM Source,UTM Campaign,Video',
                ...data.emails.map(e => {
                    const utm = e.utm_data ? JSON.parse(e.utm_data) : {};
                    return \`"\${e.email}","\${new Date(e.created_at).toLocaleString()}","\${e.tags.map(t => t.name).join(', ')}","\${utm.utm_source || ''}","\${utm.utm_campaign || ''}","\${utm.video || ''}"\`;
                })
            ].join('\\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`flowcraft-selected-\${new Date().toISOString().split('T')[0]}.csv\`;
            a.click();
            URL.revokeObjectURL(url);

            showToast(\`Exported \${data.emails.length} selected emails!\`);
        }

        function openBulkTagModal() {
            const container = document.getElementById('bulk-tag-options');
            container.innerHTML = allTags.map(t => \`
                <label style="display: inline-flex; align-items: center; gap: 4px; margin-right: 8px;">
                    <input type="checkbox" value="\${t.id}" class="bulk-tag-checkbox">
                    <span class="tag" style="background: \${t.color};">\${t.name}</span>
                </label>
            \`).join('');
            
            document.getElementById('bulk-tag-modal').classList.add('active');
        }

        function closeBulkTagModal() {
            document.getElementById('bulk-tag-modal').classList.remove('active');
        }

        async function applyBulkTags() {
            const selectedTags = Array.from(document.querySelectorAll('.bulk-tag-checkbox:checked')).map(cb => cb.value);
            
            for (const emailId of selectedEmails) {
                for (const tagId of selectedTags) {
                    await fetch('/api/email-tags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ emailId, tagId })
                    });
                }
            }
            
            closeBulkTagModal();
            showToast(\`Tags applied to \${selectedEmails.size} emails!\`);
            clearSelection();
            loadAll();
        }

        // Create tag
        document.getElementById('create-tag-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-tag-name').value;
            const color = document.getElementById('new-tag-color').value;
            
            const res = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, color })
            });
            
            const data = await res.json();
            
            if (res.ok) {
                showToast(\`Tag "\${name}" created!\`);
                document.getElementById('new-tag-name').value = '';
                loadTags();
            } else {
                showToast(data.error || 'Failed to create tag');
            }
        });

        async function deleteTag(id) {
            if (!confirm('Delete this tag? (Emails will not be deleted)')) return;
            
            await fetch(\`/api/tags?id=\${id}\`, { method: 'DELETE' });
            showToast('Tag deleted');
            loadTags();
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // Init
        checkAuth();

        // Email Template functions
        async function loadEmailTemplates() {
            const res = await fetch('/api/email-templates');
            const data = await res.json();
            
            const list = document.getElementById('templates-list');
            if (!data.templates || data.templates.length === 0) {
                list.innerHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: 1rem;">No templates yet</p>';
                return;
            }
            
            list.innerHTML = data.templates.map(t => \`
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: var(--color-bg); border-radius: 6px; border: 1px solid var(--color-border);">
                    <div>
                        <div style="font-weight: 600;">\${t.name}</div>
                        <div style="font-size: 0.8rem; color: var(--color-text-muted);">Subject: \${t.subject}</div>
                        <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 4px;">
                            \${t.is_active ? '<span style="color: #38A169;">● Active</span>' : '<span style="color: #A0AEC0;">○ Inactive</span>'}
                            · Updated \${new Date(t.updated_at).toLocaleDateString()}
                        </div>
                    </div>
                    <div style="display: flex; gap: 0.5rem;">
                        <button class="btn btn-sm btn-outline" onclick="editTemplate('\${t.id}')">Edit</button>
                        <button class="btn btn-sm btn-outline" onclick="toggleTemplate('\${t.id}', \${!t.is_active})">\${t.is_active ? 'Deactivate' : 'Activate'}</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteTemplate('\${t.id}')">Delete</button>
                    </div>
                </div>
            \`).join('');
        }

        async function saveEmailTemplate() {
            const subject = document.getElementById('template-subject').value;
            const body = document.getElementById('template-body').value;
            
            if (!subject || !body) {
                showToast('Subject and body are required!');
                return;
            }
            
            const res = await fetch('/api/email-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: 'welcome-email',
                    name: 'Welcome Email',
                    subject,
                    body_markdown: body,
                    is_active: true
                })
            });
            
            const data = await res.json();
            if (res.ok) {
                showToast('Template saved!');
                loadEmailTemplates();
            } else {
                showToast(data.error || 'Failed to save');
            }
        }

        async function previewEmailTemplate() {
            const body = document.getElementById('template-body').value;
            
            if (!body) {
                showToast('Write something first!');
                return;
            }
            
            const res = await fetch('/api/email-templates/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ body_markdown: body })
            });
            
            const data = await res.json();
            document.getElementById('template-preview').innerHTML = data.html;
        }

        async function loadEmailTemplate() {
            const res = await fetch('/api/email-templates');
            const data = await res.json();
            
            const template = data.templates?.find(t => t.id === 'welcome-email');
            if (template) {
                document.getElementById('template-subject').value = template.subject;
                document.getElementById('template-body').value = template.body_markdown;
                showToast('Template loaded!');
            } else {
                showToast('No saved template found');
            }
        }

        async function editTemplate(id) {
            const res = await fetch('/api/email-templates');
            const data = await res.json();
            
            const template = data.templates?.find(t => t.id === id);
            if (template) {
                document.getElementById('template-subject').value = template.subject;
                document.getElementById('template-body').value = template.body_markdown;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        }

        async function toggleTemplate(id, isActive) {
            const res = await fetch('/api/email-templates', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, is_active: isActive })
            });
            
            if (res.ok) {
                showToast(\`Template \${isActive ? 'activated' : 'deactivated'}!\`);
                loadEmailTemplates();
            }
        }

        async function deleteTemplate(id) {
            if (!confirm('Delete this template?')) return;
            
            // Can't delete via API yet, just show message
            showToast('Delete not implemented yet. Use deactivate instead.');
        }

        function insertMarkdown(before, after) {
            const textarea = document.getElementById('template-body');
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            const selectedText = text.substring(start, end) || after.replace(/\\*|>|#|-/g, '').trim() || 'text';
            
            const newText = text.substring(0, start) + before + selectedText + after + text.substring(end);
            textarea.value = newText;
            textarea.focus();
            textarea.selectionStart = start + before.length;
            textarea.selectionEnd = start + before.length + selectedText.length;
        }
    </script>
</body>
</html>`;
}
