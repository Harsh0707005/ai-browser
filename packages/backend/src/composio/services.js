/**
 * Service registry — one entry per integrated external service.
 *
 * key          : internal identifier used in caches and env var names
 * label        : human-readable name shown to users and the LLM
 * toolkitSlug  : fn → Composio toolkit slug (from env or default)
 * authConfigId : fn → Composio auth config ID from env (undefined = service inactive)
 * keywords     : lowercase phrases that indicate the user's message is about this service.
 *                Only services whose keywords match are loaded for a given request.
 * toolLimit    : max tools to expose to the LLM (applied when allowedSlugs is null).
 *                Keeps prompt size bounded.
 * allowedSlugs : Set of exact tool slugs to expose, or null to use toolLimit + important:true.
 *
 * To add a new service: add one entry here and set the env vars. Nothing else changes.
 */
export const SERVICES = [
  {
    key: 'calendar',
    label: 'Google Calendar',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_CALENDAR_TOOLKIT_SLUG || 'GOOGLECALENDAR',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_CALENDAR_AUTH_CONFIG_ID,
    keywords: [
      'calendar', 'event', 'events', 'meeting', 'meetings', 'schedule', 'scheduled',
      'appointment', 'appointments', 'reminder', 'reminders', 'agenda', 'today', 'tomorrow',
      'this week', 'next week', 'rsvp', 'invite', 'busy', 'free slot',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GOOGLECALENDAR_EVENTS_LIST',
      'GOOGLECALENDAR_EVENTS_LIST_ALL_CALENDARS',
      'GOOGLECALENDAR_EVENTS_GET',
      'GOOGLECALENDAR_FIND_EVENT',
      'GOOGLECALENDAR_FIND_FREE_SLOTS',
      'GOOGLECALENDAR_CREATE_EVENT',
      'GOOGLECALENDAR_UPDATE_EVENT',
      'GOOGLECALENDAR_PATCH_EVENT',
      'GOOGLECALENDAR_DELETE_EVENT',
      'GOOGLECALENDAR_QUICK_ADD',
      'GOOGLECALENDAR_GET_CURRENT_DATE_TIME',
    ]),
  },
  {
    key: 'gmail',
    label: 'Gmail',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_MAIL_TOOL_SLUG || 'GMAIL',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_MAIL_AUTH_CONFIG_ID,
    keywords: [
      'email', 'gmail', 'mail', 'inbox', 'message', 'messages', 'send email', 'compose',
      'reply', 'forward', 'unread', 'draft', 'drafts', 'attachment', 'thread', 'spam',
      'label', 'archive',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GMAIL_FETCH_EMAILS',
      'GMAIL_LIST_MESSAGES',
      'GMAIL_LIST_THREADS',
      'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
      'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
      'GMAIL_SEND_EMAIL',
      'GMAIL_CREATE_EMAIL_DRAFT',
      'GMAIL_REPLY_TO_THREAD',
      'GMAIL_FORWARD_MESSAGE',
      'GMAIL_MOVE_TO_TRASH',
      'GMAIL_ADD_LABEL_TO_EMAIL',
      'GMAIL_MODIFY_THREAD_LABELS',
      'GMAIL_LIST_LABELS',
      'GMAIL_GET_PROFILE',
    ]),
  },
  {
    key: 'docs',
    label: 'Google Docs',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_DOCS_TOOL_SLUG || 'GOOGLEDOCS',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_DOCS_AUTH_CONFIG_ID,
    keywords: [
      'doc', 'docs', 'document', 'documents', 'google doc', 'write', 'essay', 'report',
      'edit document', 'create document', 'open doc',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GOOGLEDOCS_CREATE_DOCUMENT',
      'GOOGLEDOCS_CREATE_DOCUMENT_MARKDOWN',
      'GOOGLEDOCS_GET_DOCUMENT_BY_ID',
      'GOOGLEDOCS_GET_DOCUMENT_PLAINTEXT',
      'GOOGLEDOCS_SEARCH_DOCUMENTS',
      'GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN',
      'GOOGLEDOCS_UPDATE_EXISTING_DOCUMENT',
      'GOOGLEDOCS_INSERT_TEXT_ACTION',
      'GOOGLEDOCS_REPLACE_ALL_TEXT',
      'GOOGLEDOCS_EXPORT_DOCUMENT_AS_PDF',
    ]),
  },
  {
    key: 'sheets',
    label: 'Google Sheets',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_SHEETS_TOOL_SLUG || 'GOOGLESHEETS',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_SHEETS_AUTH_CONFIG_ID,
    keywords: [
      'sheet', 'sheets', 'spreadsheet', 'google sheet', 'cell', 'cells', 'row', 'rows',
      'column', 'columns', 'csv', 'table data', 'excel',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GOOGLESHEETS_CREATE_GOOGLE_SHEET1',
      'GOOGLESHEETS_SHEET_FROM_JSON',
      'GOOGLESHEETS_GET_SPREADSHEET_INFO',
      'GOOGLESHEETS_GET_SHEET_NAMES',
      'GOOGLESHEETS_SEARCH_SPREADSHEETS',
      'GOOGLESHEETS_VALUES_GET',
      'GOOGLESHEETS_VALUES_UPDATE',
      'GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND',
      'GOOGLESHEETS_CREATE_SPREADSHEET_ROW',
      'GOOGLESHEETS_UPSERT_ROWS',
      'GOOGLESHEETS_FIND_WORKSHEET_BY_TITLE',
      'GOOGLESHEETS_EXECUTE_SQL',
    ]),
  },
  {
    key: 'drive',
    label: 'Google Drive',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_DRIVE_TOOL_SLUG || 'GOOGLEDRIVE',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_DRIVE_AUTH_CONFIG_ID,
    keywords: [
      'drive', 'google drive', 'file', 'files', 'folder', 'folders', 'upload', 'download',
      'share file', 'share link', 'my drive', 'storage',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GOOGLEDRIVE_FIND_FILE',
      'GOOGLEDRIVE_FIND_FOLDER',
      'GOOGLEDRIVE_LIST_FILES',
      'GOOGLEDRIVE_GET_FILE_METADATA',
      'GOOGLEDRIVE_CREATE_FOLDER',
      'GOOGLEDRIVE_CREATE_FILE_FROM_TEXT',
      'GOOGLEDRIVE_MOVE_FILE',
      'GOOGLEDRIVE_DELETE_FILE',
      'GOOGLEDRIVE_DOWNLOAD_FILE',
      'GOOGLEDRIVE_ADD_FILE_SHARING_PREFERENCE',
      'GOOGLEDRIVE_UPLOAD_FILE',
    ]),
  },
  {
    key: 'meet',
    label: 'Google Meet',
    toolkitSlug: () => process.env.COMPOSIO_GOOGLE_MEET_TOOL_SLUG || 'GOOGLEMEET',
    authConfigId: () => process.env.COMPOSIO_GOOGLE_MEET_AUTH_CONFIG_ID,
    keywords: [
      'meet', 'google meet', 'video call', 'video meeting', 'meeting link', 'join call',
      'start call', 'instant meeting', 'conference', 'create meet', 'meeting room',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'GOOGLEMEET_CREATE_MEET',
      'GOOGLEMEET_CREATE_SPACE',
      'GOOGLEMEET_GET_MEET',
      'GOOGLEMEET_GET_SPACE',
      'GOOGLEMEET_UPDATE_SPACE',
      'GOOGLEMEET_END_ACTIVE_CONFERENCE',
      'GOOGLEMEET_LIST_CONFERENCE_RECORDS',
    ]),
  },
  {
    key: 'youtube',
    label: 'YouTube',
    toolkitSlug: () => process.env.COMPOSIO_YOUTUBE_TOOL_SLUG || 'YOUTUBE',
    authConfigId: () => process.env.COMPOSIO_YOUTUBE_AUTH_CONFIG_ID,
    keywords: [
      'youtube', 'video', 'videos', 'channel', 'subscribe', 'playlist', 'upload video',
      'watch later', 'liked videos', 'my channel', 'youtube video',
    ],
    toolLimit: 8,
    allowedSlugs: new Set([
      'YOUTUBE_SEARCH_YOU_TUBE',
      'YOUTUBE_GET_VIDEO_DETAILS_BATCH',
      'YOUTUBE_LIST_MOST_POPULAR_VIDEOS',
      'YOUTUBE_LIST_CHANNEL_VIDEOS',
      'YOUTUBE_GET_CHANNEL_STATISTICS',
      'YOUTUBE_GET_CHANNEL_ID_BY_HANDLE',
      'YOUTUBE_LIST_USER_SUBSCRIPTIONS',
      'YOUTUBE_SUBSCRIBE_CHANNEL',
      'YOUTUBE_UNSUBSCRIBE_CHANNEL',
      'YOUTUBE_LIST_USER_PLAYLISTS',
      'YOUTUBE_CREATE_PLAYLIST',
      'YOUTUBE_ADD_VIDEO_TO_PLAYLIST',
      'YOUTUBE_RATE_VIDEO',
      'YOUTUBE_POST_COMMENT',
    ]),
  },
]

/**
 * Returns the subset of active (configured) services whose keywords match the message.
 * Falls back to an empty array if nothing matches — caller decides what to do.
 */
export function matchServices(message) {
  const lc = message.toLowerCase()
  const active = SERVICES.filter(s => s.authConfigId())
  return active.filter(s => s.keywords.some(kw => lc.includes(kw)))
}

/**
 * Find the service that owns a given tool slug by matching the toolkit slug prefix.
 * Case-insensitive: tool slugs from Composio are uppercase (e.g. GOOGLEMEET_CREATE_MEET)
 * while toolkit slugs in env may be lowercase (e.g. googlemeet).
 */
export function findServiceByToolSlug(toolSlug) {
  const upper = toolSlug.toUpperCase()
  return SERVICES.find(s => upper.startsWith(s.toolkitSlug().toUpperCase()))
}
