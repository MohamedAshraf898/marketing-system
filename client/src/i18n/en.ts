// English dictionary. Keys are flat "group.key" strings; {name} style placeholders are filled by t().
// Add a key here first, then add its Arabic translation in ar.ts (TypeScript enforces both files stay in sync).
export const en = {
  'app.name': 'OG System',

  // ── navigation / shell ──
  'nav.dashboard': 'Dashboard', 'nav.clients': 'Clients', 'nav.users': 'Users', 'nav.campaigns': 'Campaigns', 'nav.deliverables': 'Deliverables',
  'nav.approvals': 'Approvals', 'nav.requests': 'Requests', 'nav.reports': 'Reports', 'nav.files': 'Files', 'nav.auditLog': 'Audit log', 'nav.settings': 'Settings',
  'shell.clientPortal': 'Client portal', 'shell.agencyWorkspace': 'Agency workspace', 'shell.adminConsole': 'Administrator', 'shell.teamConsole': 'Team member',
  'shell.system': 'System', 'shell.more': 'More', 'shell.openMenu': 'Open menu',

  // ── auth ──
  'auth.email': 'Email', 'auth.password': 'Password', 'auth.login': 'Sign in', 'auth.logout': 'Sign out', 'auth.showPassword': 'Show password', 'auth.hidePassword': 'Hide password',
  'login.title': 'Welcome back', 'login.subtitle': 'Sign in to your OG System account.',
  'login.headline': 'Every campaign, approval and report in one calm place.',
  'login.subheadline': 'Review creative, approve with one tap, and follow performance — without a single email thread.',
  'login.point1': 'Approve or request changes in seconds', 'login.point2': 'Real performance reports, always up to date', 'login.point3': 'Your files and data stay private to your company',
  'login.help': 'Trouble signing in? Contact your account manager.',
  'notFound.title': 'Page not found', 'notFound.text': 'The page you are looking for does not exist or you do not have access to it.', 'notFound.home': 'Back to dashboard',

  // ── common ──
  'common.actions': 'Actions', 'common.allClients': 'All clients', 'common.allStatuses': 'All statuses', 'common.cancel': 'Cancel', 'common.clear': 'Clear', 'common.close': 'Close',
  'common.confirm': 'Confirm', 'common.created': 'Created', 'common.date': 'Date', 'common.delete': 'Delete', 'common.description': 'Description', 'common.due': 'Due {date}',
  'common.edit': 'Edit', 'common.email': 'Email', 'common.loadFailed': 'Something went wrong', 'common.loadFailedHint': 'We could not load this. Please try again.',
  'common.name': 'Name', 'common.next': 'Next', 'common.previous': 'Previous', 'common.noResultsHint': 'Try changing or clearing the filters.', 'common.none': 'Nothing to show',
  'common.notFoundHint': 'This item does not exist or you do not have access to it.', 'common.notes': 'Notes', 'common.optional': 'Optional', 'common.pageOf': 'Page {page} of {total}',
  'common.phone': 'Phone', 'common.remove': 'Remove', 'common.retry': 'Try again', 'common.saveChanges': 'Save changes', 'common.search': 'Search…', 'common.select': 'Select…',
  'common.status': 'Status', 'common.viewAll': 'View all',

  // ── dashboard ──
  'dashboard.welcome': 'Welcome back, {name}', 'dashboard.clientSubtitle': "Here's what's happening with {company}.", 'dashboard.adminSubtitle': 'A live view of the whole agency.',
  'dashboard.teamSubtitle': 'Your assigned clients, campaigns and open work.', 'dashboard.quickActions': 'Quick actions',
  'dashboard.needsYourApproval': 'Needs your approval', 'dashboard.pendingApprovals': 'Waiting for client approval', 'dashboard.noPending': 'Nothing waiting for approval',
  'dashboard.noPendingClient': "You're all caught up.", 'dashboard.activeCampaigns': 'Active campaigns', 'dashboard.noActiveCampaigns': 'No running campaigns yet',
  'dashboard.yourRequests': 'Your requests', 'dashboard.openRequests': 'Open requests', 'dashboard.noRequests': 'No requests yet', 'dashboard.recentReports': 'Recent reports',
  'dashboard.noReports': 'No reports yet', 'dashboard.clientFeedback': 'Latest client feedback', 'dashboard.noFeedback': 'No feedback yet', 'dashboard.commented': 'Commented',
  'kpi.activeCampaigns': 'Active campaigns', 'kpi.pendingApprovals': 'Pending approvals', 'kpi.openRequests': 'Open requests', 'kpi.totalSpend': 'Total spend',
  'kpi.totalClients': 'Total clients', 'kpi.activeClients': 'Active clients', 'kpi.assignedClients': 'Assigned clients', 'kpi.assignedCampaigns': 'Assigned campaigns', 'kpi.pendingDeliverables': 'To finish',

  // ── metrics ──
  'metric.spend': 'Spend', 'metric.reach': 'Reach', 'metric.impressions': 'Impressions', 'metric.clicks': 'Clicks', 'metric.ctr': 'CTR', 'metric.cpc': 'CPC', 'metric.cpm': 'CPM',
  'metric.conversions': 'Conversions', 'metric.conversionValue': 'Conversion value', 'metric.roas': 'ROAS',

  // ── clients ──
  'client.title': 'Client', 'client.subtitle': 'Companies you manage.', 'client.search': 'Search clients…', 'client.new': 'New client', 'client.edit': 'Edit client', 'client.create': 'Create client',
  'client.created': 'Client created', 'client.updated': 'Client updated', 'client.empty': 'No clients found', 'client.emptyHint': 'Create your first client to start adding campaigns.',
  'client.emptyTeamHint': 'You have not been assigned to any client yet. Ask an administrator.', 'client.companyName': 'Company name', 'client.contactName': 'Contact person',
  'client.uploadLogo': 'Upload logo', 'client.logoHint': 'PNG, JPG, WebP or GIF up to 2 MB.', 'client.logoFailed': 'The client was saved, but the logo could not be uploaded.',
  'client.portalUsers': 'Portal users', 'client.portalUsersHint': 'People who can sign in for this client.', 'client.noUsers': 'No portal users yet. Create one from Users.',
  'client.assignedTeam': 'Assigned team', 'client.noTeam': 'No team members assigned.',

  // ── users ──
  'user.subtitle': 'Everyone who can sign in.', 'user.search': 'Search by name or email…', 'user.allRoles': 'All roles', 'user.new': 'New user', 'user.edit': 'Edit user', 'user.create': 'Create user',
  'user.created': 'User created', 'user.updated': 'User updated', 'user.empty': 'No users found', 'user.role': 'Role', 'user.lastLogin': 'Last sign-in', 'user.never': 'Never', 'user.you': 'you',
  'user.menu': 'Account menu', 'user.newPassword': 'New password', 'user.newPasswordHint': 'Leave empty to keep the current password.', 'user.passwordRules': 'At least 8 characters, with letters and numbers.',
  'user.assignedClients': 'Assigned clients', 'user.assignedClientsHint': 'The team member sees everything for these clients.',
  'user.assignedCampaigns': 'Individual campaigns', 'user.assignedCampaignsHint': 'Give access to single campaigns without exposing the rest of the client.',

  // ── campaigns ──
  'campaign.subtitle': 'Track every campaign, budget and result.', 'campaign.search': 'Search campaigns…', 'campaign.new': 'New campaign', 'campaign.edit': 'Edit campaign', 'campaign.create': 'Create campaign',
  'campaign.created': 'Campaign created', 'campaign.updated': 'Campaign updated', 'campaign.deleted': 'Campaign deleted', 'campaign.empty': 'No campaigns found',
  'campaign.emptyHint': 'Create a campaign for one of your clients.', 'campaign.emptyRestrictedHint': 'Campaigns will appear here once they are created for you.',
  'campaign.name': 'Campaign name', 'campaign.platform': 'Platform', 'campaign.objective': 'Objective', 'campaign.status': 'Status', 'campaign.startDate': 'Start date', 'campaign.endDate': 'End date',
  'campaign.budget': 'Budget', 'campaign.spent': 'Spent', 'campaign.spentHint': 'Updated automatically from daily reports.', 'campaign.externalId': 'Platform campaign ID',
  'campaign.externalIdHint': 'Optional. Used for future ad-platform integrations.', 'campaign.allPlatforms': 'All platforms', 'campaign.allObjectives': 'All objectives',
  'campaign.budgetSpent': 'Spent / budget', 'campaign.dates': 'Dates', 'campaign.tabOverview': 'Overview', 'campaign.details': 'Campaign details',
  'campaign.noReportsYet': 'No performance data yet. Numbers appear here once daily reports are added.', 'campaign.ofBudget': 'of {budget} budget', 'campaign.percentUsed': '{pct}% of the budget used',
  'campaign.deleteTitle': 'Delete this campaign?', 'campaign.deleteMessage': '"{name}" and its reports will be deleted. Deliverables and their approval history are kept.',

  // ── deliverables & review ──
  'deliverable.subtitle': 'Creative work, from draft to approval.', 'deliverable.search': 'Search deliverables…', 'deliverable.allTypes': 'All types', 'deliverable.new': 'New deliverable',
  'deliverable.newHint': 'Create it as a draft. Nothing is visible to the client until you send it for approval.', 'deliverable.create': 'Create deliverable', 'deliverable.edit': 'Edit deliverable',
  'deliverable.created': 'Deliverable created', 'deliverable.updated': 'Deliverable updated', 'deliverable.empty': 'No deliverables found',
  'deliverable.emptyHint': 'Create the first deliverable to start the approval flow.', 'deliverable.emptyClientHint': 'Deliverables appear here once your agency sends them for approval.',
  'deliverable.name': 'Deliverable name', 'deliverable.campaign': 'Campaign', 'deliverable.type': 'Type', 'deliverable.dueDate': 'Due date', 'deliverable.previewUrl': 'Preview link',
  'deliverable.previewUrlHint': 'Optional link to a Drive/Figma/video preview (http or https).', 'deliverable.descriptionPlaceholder': 'What is this and what should the client look at?',
  'review.approve': 'Approve', 'review.requestChanges': 'Request changes', 'review.approveTitle': 'Approve this deliverable?', 'review.changesTitle': 'Request changes',
  'review.decisionFor': '{name} · version {version}', 'review.commentOptional': 'Comment (optional)', 'review.whatToChange': 'What should be changed?',
  'review.approveHint': 'Approvals are recorded permanently in the history.', 'review.changesHint': 'Be specific so the team can fix everything in one round.',
  'review.approvePlaceholder': 'Looks great!', 'review.changesPlaceholder': 'e.g. Make the headline larger and use the blue logo.', 'review.sendChanges': 'Send feedback',
  'review.approvedToast': 'Approved. The team has been notified.', 'review.changesToast': 'Feedback sent to the team.',
  'review.yourDecision': 'Your decision', 'review.yourDecisionHint': 'Approve it, or tell the team what to change.',
  'review.history': 'Approval history', 'review.historyHint': 'Every submission and decision, in order. Records are never overwritten.', 'review.noHistory': 'Not submitted for approval yet.',
  'review.tlSubmitted': 'Sent for approval', 'review.tlApproved': 'Approved', 'review.tlChanges': 'Changes requested', 'review.version': 'Version', 'review.versionN': 'Version {n}',
  'review.files': 'Files', 'review.openPreview': 'Open preview', 'review.changesRequestedBanner': 'Changes requested', 'review.draftBanner': 'This is a draft. The client cannot see it until you send it for approval.',
  'review.submitForApproval': 'Send for approval', 'review.submitTitle': 'Send to the client?', 'review.submitMessage': 'Version {version} will become visible to the client and locked for editing.',
  'review.submittedToast': 'Sent for approval', 'review.startNewVersion': 'Create new version', 'review.newVersionTitle': 'Start a new version?',
  'review.newVersionMessage': 'A new draft (version {version}) is created so you can apply the requested changes. The previous versions stay in the history.', 'review.newVersionToast': 'New version created',
  'review.markPublished': 'Mark as published', 'review.publishTitle': 'Mark as published?', 'review.publishMessage': 'Use this when the approved creative is live in the campaign.', 'review.publishedToast': 'Marked as published',
  'review.uploadForVersion': 'Upload file for version {n}',
  'review.comments': 'Comments', 'review.commentsHint': 'Start the conversation.', 'review.commentPlaceholder': 'Write a comment…', 'review.addComment': 'Add a comment', 'review.postComment': 'Post comment',
  'review.authorClient': 'Client', 'review.authorTeam': 'Team',

  // ── approvals ──
  'approvals.subtitle': 'Everything waiting for a decision, and every decision made.', 'approvals.tabPending': 'Waiting for review', 'approvals.tabHistory': 'History',
  'approvals.nonePending': 'Nothing is waiting for approval', 'approvals.nonePendingClient': "You're all caught up. New work will show up here.", 'approvals.nonePendingStaff': 'Deliverables you send for approval will show up here.',
  'approvals.review': 'Review', 'approvals.view': 'View', 'approvals.submittedAgo': 'Sent {when}', 'approvals.allDecisions': 'All decisions', 'approvals.noHistory': 'No decisions yet',
  'approvals.noHistoryHint': 'Approvals and change requests will be listed here.', 'approvals.decision': 'Decision', 'approvals.comment': 'Comment', 'approvals.by': 'By',

  // ── requests ──
  'request.subtitle': 'Ask for new work and follow its progress.', 'request.search': 'Search requests…', 'request.new': 'New request', 'request.newHint': 'Tell us what you need. We will get back to you soon.',
  'request.submit': 'Submit request', 'request.created': 'Request submitted', 'request.updated': 'Request updated', 'request.empty': 'No requests found',
  'request.emptyHint': 'Need a new design, video or copy? Create a request.', 'request.emptyStaffHint': 'Requests created by clients will show up here.',
  'request.title': 'Title', 'request.type': 'Type', 'request.priority': 'Priority', 'request.campaign': 'Campaign', 'request.noCampaign': 'No specific campaign', 'request.assignedTo': 'Assigned to',
  'request.unassigned': 'Unassigned', 'request.dueDate': 'Due date', 'request.completedAt': 'Completed', 'request.descriptionPlaceholder': 'Describe what you need, sizes, references, deadlines…',
  'request.attachment': 'Attachment', 'request.attachments': 'Attachments', 'request.attach': 'Add attachment', 'request.noAttachments': 'No attachments.',
  'request.attachmentFailed': 'The request was created, but the attachment could not be uploaded.', 'request.details': 'Details', 'request.allPriorities': 'All priorities', 'request.allTypes': 'All types',
  'request.cancel': 'Cancel request', 'request.cancelTitle': 'Cancel this request?', 'request.cancelMessage': 'The team will be notified that you no longer need this.', 'request.cancelConfirm': 'Cancel request',

  // ── reports ──
  'report.subtitle': 'Performance from real daily numbers.', 'report.new': 'Add report', 'report.newHint': 'Enter the raw numbers for one campaign and day.', 'report.save': 'Save report',
  'report.created': 'Report saved', 'report.deleted': 'Report deleted', 'report.date': 'Date', 'report.from': 'From', 'report.to': 'To', 'report.allCampaigns': 'All campaigns',
  'report.last7': 'Last 7 days', 'report.last30': 'Last 30 days', 'report.allTime': 'All time', 'report.empty': 'No report data', 'report.emptyHint': 'Numbers appear here once daily reports are added.',
  'report.calculatedHint': 'CTR, CPC, CPM and ROAS are calculated automatically.', 'report.chartSpend': 'Spend over time', 'report.chartClicks': 'Clicks over time',
  'report.chartConversions': 'Conversions over time', 'report.chartRoas': 'ROAS over time', 'report.daily': 'Daily results',
  'report.deleteTitle': 'Delete this report?', 'report.deleteMessage': 'The report for {date} will be removed and the campaign spend recalculated.',

  // ── files ──
  'file.subtitle': 'Every file shared between you and your agency.', 'file.search': 'Search files…', 'file.allTypes': 'All file types', 'file.kindImage': 'Images', 'file.kindVideo': 'Videos',
  'file.kindDocument': 'Documents', 'file.upload': 'Upload file', 'file.uploaded': 'File uploaded', 'file.uploadDraftHint': 'Files stay hidden from the client until this version is sent for approval.',
  'file.choose': 'Choose a file or drop it here', 'file.hint': 'Images, video, PDF, documents. Max {mb} MB.', 'file.name': 'File', 'file.attachedTo': 'Attached to', 'file.uploadedBy': 'Uploaded by',
  'file.campaign': 'Campaign', 'file.visibility': 'Visibility', 'file.visible': 'Client can see', 'file.internal': 'Internal', 'file.visibleToClient': 'Visible to the client', 'file.download': 'Download',
  'file.empty': 'No files yet', 'file.emptyHint': 'Uploaded files will be listed here.', 'file.deleted': 'File deleted', 'file.deleteTitle': 'Delete this file?', 'file.deleteMessage': '"{name}" will be permanently deleted.',
  'file.tooLarge': 'This file is larger than {mb} MB.', 'file.typeNotAllowed': 'This file type is not allowed.', 'file.emptyFile': 'This file is empty.',

  // ── notifications ──
  'notif.title': 'Notifications', 'notif.markAllRead': 'Mark all as read', 'notif.allRead': 'All caught up', 'notif.viewAll': 'View all notifications', 'notif.empty': "You're all caught up",
  'notif.emptyHint': 'New activity will show up here.', 'notif.filterAll': 'All', 'notif.filterUnread': 'Unread', 'notif.unreadCount': '{n} unread',
  'notif.NEW_REQUEST': '{by} created a new request: {title}', 'notif.DELIVERABLE_SUBMITTED': '"{name}" (v{version}) is ready for your approval', 'notif.DELIVERABLE_APPROVED': '{client} approved "{name}" (v{version})',
  'notif.CHANGES_REQUESTED': '{client} requested changes on "{name}" (v{version})', 'notif.REQUEST_STATUS_CHANGED': 'Request "{title}" is now {status}', 'notif.REQUEST_ASSIGNED': 'You were assigned the request "{title}"',
  'notif.NEW_COMMENT': '{by} commented on "{name}"', 'notif.DELIVERABLE_PUBLISHED': '"{name}" was published',

  // ── settings ──
  'settings.title': 'Settings', 'settings.subtitle': 'Your profile, language and security.', 'settings.profile': 'Profile', 'settings.profileSaved': 'Profile updated',
  'settings.language': 'Language', 'settings.languageHint': 'Arabic switches the whole interface to right-to-left.', 'settings.password': 'Password', 'settings.passwordHint': 'Changing it signs you out on other devices.',
  'settings.currentPassword': 'Current password', 'settings.newPassword': 'New password', 'settings.confirmPassword': 'Confirm new password', 'settings.passwordMismatch': 'Passwords do not match.',
  'settings.changePassword': 'Change password', 'settings.passwordChanged': 'Password changed',

  // ── audit log ──
  'audit.subtitle': 'Who did what, and when. Visible to administrators only.', 'audit.search': 'Search by record ID or details…', 'audit.allActions': 'All actions', 'audit.allEntities': 'All records',
  'audit.empty': 'No activity found', 'audit.action': 'Action', 'audit.user': 'User', 'audit.entity': 'Record', 'audit.details': 'Details', 'audit.when': 'When', 'audit.system': 'System',

  // ── enum labels ──
  'clientStatus.ACTIVE': 'Active', 'clientStatus.PAUSED': 'Paused', 'clientStatus.ARCHIVED': 'Archived',
  'userStatus.ACTIVE': 'Active', 'userStatus.INACTIVE': 'Inactive',
  'role.ADMIN': 'Admin', 'role.TEAM': 'Team', 'role.CLIENT': 'Client',
  'platform.META': 'Meta', 'platform.GOOGLE': 'Google', 'platform.TIKTOK': 'TikTok', 'platform.SNAPCHAT': 'Snapchat', 'platform.OTHER': 'Other',
  'objective.SALES': 'Sales', 'objective.LEADS': 'Leads', 'objective.TRAFFIC': 'Traffic', 'objective.AWARENESS': 'Awareness', 'objective.ENGAGEMENT': 'Engagement',
  'campaignStatus.PLANNING': 'Planning', 'campaignStatus.PENDING_APPROVAL': 'Pending approval', 'campaignStatus.RUNNING': 'Running', 'campaignStatus.PAUSED': 'Paused', 'campaignStatus.COMPLETED': 'Completed',
  'deliverableType.DESIGN': 'Design', 'deliverableType.VIDEO': 'Video', 'deliverableType.REEL': 'Reel', 'deliverableType.STORY': 'Story', 'deliverableType.COPY': 'Copy', 'deliverableType.BANNER': 'Banner', 'deliverableType.OTHER': 'Other',
  'deliverableStatus.DRAFT': 'Draft', 'deliverableStatus.PENDING_APPROVAL': 'Pending approval', 'deliverableStatus.APPROVED': 'Approved', 'deliverableStatus.CHANGES_REQUESTED': 'Changes requested', 'deliverableStatus.PUBLISHED': 'Published',
  'decision.PENDING': 'Pending', 'decision.APPROVED': 'Approved', 'decision.CHANGES_REQUESTED': 'Changes requested',
  'requestType.DESIGN': 'Design', 'requestType.VIDEO': 'Video', 'requestType.COPY': 'Copy', 'requestType.CAMPAIGN': 'Campaign', 'requestType.OTHER': 'Other',
  'requestStatus.NEW': 'New', 'requestStatus.IN_PROGRESS': 'In progress', 'requestStatus.WAITING_CLIENT': 'Waiting for client', 'requestStatus.COMPLETED': 'Completed', 'requestStatus.CANCELLED': 'Cancelled',
  'priority.LOW': 'Low', 'priority.NORMAL': 'Normal', 'priority.HIGH': 'High', 'priority.URGENT': 'Urgent',
  'auditEntity.user': 'User', 'auditEntity.client': 'Client', 'auditEntity.campaign': 'Campaign', 'auditEntity.deliverable': 'Deliverable', 'auditEntity.request': 'Request', 'auditEntity.report': 'Report', 'auditEntity.file': 'File',
  'auditAction.USER_LOGIN': 'Signed in', 'auditAction.USER_CREATED': 'User created', 'auditAction.USER_UPDATED': 'User updated', 'auditAction.USER_ASSIGNMENTS_UPDATED': 'Assignments updated', 'auditAction.PASSWORD_CHANGED': 'Password changed',
  'auditAction.CLIENT_CREATED': 'Client created', 'auditAction.CLIENT_UPDATED': 'Client updated', 'auditAction.CLIENT_ARCHIVED': 'Client archived',
  'auditAction.CAMPAIGN_CREATED': 'Campaign created', 'auditAction.CAMPAIGN_UPDATED': 'Campaign updated', 'auditAction.CAMPAIGN_DELETED': 'Campaign deleted',
  'auditAction.DELIVERABLE_CREATED': 'Deliverable created', 'auditAction.DELIVERABLE_UPDATED': 'Deliverable updated', 'auditAction.DELIVERABLE_SUBMITTED': 'Sent for approval',
  'auditAction.DELIVERABLE_APPROVED': 'Deliverable approved', 'auditAction.CHANGES_REQUESTED': 'Changes requested', 'auditAction.DELIVERABLE_NEW_VERSION': 'New version started', 'auditAction.DELIVERABLE_PUBLISHED': 'Deliverable published',
  'auditAction.REQUEST_CREATED': 'Request created', 'auditAction.REQUEST_UPDATED': 'Request updated', 'auditAction.REQUEST_STATUS_CHANGED': 'Request status changed',
  'auditAction.REPORT_CREATED': 'Report added', 'auditAction.REPORT_DELETED': 'Report deleted', 'auditAction.FILE_UPLOADED': 'File uploaded', 'auditAction.FILE_DELETED': 'File deleted', 'auditAction.COMMENT_CREATED': 'Comment added',

  // ── API errors (by code) ──
  'error.NETWORK_ERROR': 'Cannot reach the server. Check your connection and try again.', 'error.INTERNAL_ERROR': 'Something went wrong on our side. Please try again.', 'error.DATABASE_ERROR': 'Something went wrong on our side. Please try again.',
  'error.VALIDATION_ERROR': 'Please check the highlighted fields.', 'error.INVALID_CREDENTIALS': 'Incorrect email or password.', 'error.ACCOUNT_DISABLED': 'This account has been disabled. Contact your administrator.',
  'error.TOO_MANY_ATTEMPTS': 'Too many attempts. Please wait a few minutes and try again.', 'error.UNAUTHENTICATED': 'Your session has expired. Please sign in again.', 'error.FORBIDDEN': 'You do not have permission to do that.',
  'error.NOT_FOUND': 'We could not find what you were looking for.', 'error.INVALID_STATE': 'This action is not possible in the current state.', 'error.NOT_PENDING': 'This item is no longer waiting for a decision.',
  'error.DELIVERABLE_LOCKED': 'Only drafts can be changed. Start a new version to make changes.', 'error.DELIVERABLE_EMPTY': 'Add a preview link, a description or a file before sending for approval.',
  'error.REPORT_EXISTS': 'A report for this campaign and date already exists.', 'error.CANNOT_MODIFY_SELF': 'You cannot change your own role or deactivate yourself.',
  'error.ASSIGNMENTS_TEAM_ONLY': 'Only team members can be assigned to clients or campaigns.', 'error.CLIENT_CHANGE_NOT_ALLOWED': 'A campaign cannot be moved to another client.',
  'error.FILE_REQUIRED': 'Please choose a file.', 'error.FILE_EMPTY': 'This file is empty.', 'error.FILE_TOO_LARGE': 'This file is too large.', 'error.LIMIT_FILE_SIZE': 'This file is too large.',
  'error.FILE_TYPE_NOT_ALLOWED': 'This file type is not allowed.', 'error.FILE_CONTENT_MISMATCH': "The file's content does not match its type.", 'error.UPLOAD_FAILED': 'The upload failed. Please try again.',
  'error.PAYLOAD_TOO_LARGE': 'The request is too large.', 'error.INVALID_JSON': 'The request could not be read.', 'error.CONFLICT': 'This conflicts with existing data.',

  // ── field validation (by code) ──
  'validation.invalid': 'This value is not valid.', 'validation.required': 'This field is required.', 'validation.invalid_email': 'Enter a valid email address.', 'validation.too_short': 'This is too short.',
  'validation.too_long': 'This is too long.', 'validation.too_small': 'This number is too small.', 'validation.too_big': 'This number is too large.', 'validation.invalid_url': 'Enter a valid link starting with http:// or https://.',
  'validation.invalid_choice': 'Please choose a valid option.', 'validation.not_allowed': 'This is not allowed.', 'validation.email_taken': 'This email is already used by another account.',
  'validation.password_too_short': 'Use at least 8 characters.', 'validation.password_weak': 'Use both letters and numbers.', 'validation.wrong_password': 'The current password is incorrect.',
  'validation.invalid_date': 'Enter a valid date.', 'validation.date_in_future': 'The date cannot be in the future.', 'validation.end_before_start': 'The end date must be after the start date.',
  'validation.campaign_client_mismatch': 'This campaign does not belong to the selected client.',
} as const;

export type TKey = keyof typeof en;
