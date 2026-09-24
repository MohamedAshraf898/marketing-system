// Arabic dictionary (Modern Standard Arabic). Must contain every key of en.ts - TypeScript enforces it.
import type { TKey } from './en';

import { coreAr } from './p2/core.ar';
import { crmAr } from './p2/crm.ar';
import { workAr } from './p2/work.ar';
import { timeAr } from './p2/time.ar';
import { contentAr } from './p2/content.ar';
import { financeAr } from './p2/finance.ar';
import { insightsAr } from './p2/insights.ar';
import { adminAr } from './p2/admin.ar';
import { phase3Ar } from './p2/phase3.ar';
export const ar: Record<TKey, string> = {
  ...coreAr,
  ...crmAr,
  ...workAr,
  ...timeAr,
  ...contentAr,
  ...financeAr,
  ...insightsAr,
  ...adminAr,
  ...phase3Ar,

  'app.name': 'فاموليا',

  // ── التنقل ──
  'nav.dashboard': 'لوحة التحكم', 'nav.clients': 'العملاء', 'nav.users': 'المستخدمون', 'nav.campaigns': 'الحملات', 'nav.deliverables': 'المخرجات',
  'nav.approvals': 'الموافقات', 'nav.requests': 'الطلبات', 'nav.reports': 'التقارير', 'nav.files': 'الملفات', 'nav.auditLog': 'سجل النشاط', 'nav.settings': 'الإعدادات',
  'shell.clientPortal': 'بوابة العميل', 'shell.agencyWorkspace': 'مساحة عمل الوكالة', 'shell.adminConsole': 'مسؤول النظام', 'shell.teamConsole': 'عضو الفريق',
  'shell.system': 'النظام', 'shell.more': 'المزيد', 'shell.openMenu': 'فتح القائمة',

  // ── الدخول ──
  'auth.email': 'البريد الإلكتروني', 'auth.password': 'كلمة المرور', 'auth.login': 'تسجيل الدخول', 'auth.logout': 'تسجيل الخروج', 'auth.showPassword': 'إظهار كلمة المرور', 'auth.hidePassword': 'إخفاء كلمة المرور',
  'login.title': 'أهلًا بعودتك', 'login.subtitle': 'سجّل الدخول إلى حسابك في فاموليا.',
  'login.headline': 'كل حملة وموافقة وتقرير في مكان واحد هادئ.',
  'login.subheadline': 'راجع التصاميم ووافق عليها بلمسة واحدة وتابع الأداء، دون سلاسل رسائل بريدية لا تنتهي.',
  'login.point1': 'وافق أو اطلب التعديل في ثوانٍ', 'login.point2': 'تقارير أداء حقيقية ومحدَّثة دائمًا', 'login.point3': 'ملفاتك وبياناتك خاصة بشركتك فقط',
  'login.help': 'هل تواجه مشكلة في الدخول؟ تواصل مع مدير حسابك.',
  'notFound.title': 'الصفحة غير موجودة', 'notFound.text': 'الصفحة التي تبحث عنها غير موجودة أو لا تملك صلاحية الوصول إليها.', 'notFound.home': 'العودة إلى لوحة التحكم',

  // ── عام ──
  'common.actions': 'الإجراءات', 'common.allClients': 'كل العملاء', 'common.allStatuses': 'كل الحالات', 'common.cancel': 'إلغاء', 'common.clear': 'مسح', 'common.close': 'إغلاق',
  'common.confirm': 'تأكيد', 'common.created': 'تاريخ الإنشاء', 'common.date': 'التاريخ', 'common.delete': 'حذف', 'common.description': 'الوصف', 'common.due': 'الموعد {date}',
  'common.edit': 'تعديل', 'common.email': 'البريد الإلكتروني', 'common.loadFailed': 'حدث خطأ ما', 'common.loadFailedHint': 'تعذّر تحميل هذا المحتوى. يرجى المحاولة مرة أخرى.',
  'common.name': 'الاسم', 'common.next': 'التالي', 'common.previous': 'السابق', 'common.noResultsHint': 'جرّب تغيير عوامل التصفية أو مسحها.', 'common.none': 'لا يوجد شيء للعرض',
  'common.notFoundHint': 'هذا العنصر غير موجود أو لا تملك صلاحية الوصول إليه.', 'common.notes': 'ملاحظات', 'common.optional': 'اختياري', 'common.pageOf': 'صفحة {page} من {total}',
  'common.phone': 'الهاتف', 'common.remove': 'إزالة', 'common.retry': 'حاول مرة أخرى', 'common.saveChanges': 'حفظ التغييرات', 'common.search': 'بحث…', 'common.select': 'اختر…',
  'common.status': 'الحالة', 'common.viewAll': 'عرض الكل',

  // ── لوحة التحكم ──
  'dashboard.welcome': 'أهلًا بعودتك يا {name}', 'dashboard.clientSubtitle': 'إليك آخر المستجدات في {company}.', 'dashboard.adminSubtitle': 'نظرة مباشرة على الوكالة بأكملها.',
  'dashboard.teamSubtitle': 'عملاؤك وحملاتك المسندة إليك والأعمال المفتوحة.', 'dashboard.quickActions': 'إجراءات سريعة',
  'dashboard.needsYourApproval': 'بانتظار موافقتك', 'dashboard.pendingApprovals': 'بانتظار موافقة العميل', 'dashboard.noPending': 'لا يوجد شيء بانتظار الموافقة',
  'dashboard.noPendingClient': 'لقد أنجزت كل شيء.', 'dashboard.activeCampaigns': 'الحملات النشطة', 'dashboard.noActiveCampaigns': 'لا توجد حملات قيد التشغيل بعد',
  'dashboard.yourRequests': 'طلباتك', 'dashboard.openRequests': 'الطلبات المفتوحة', 'dashboard.noRequests': 'لا توجد طلبات بعد', 'dashboard.recentReports': 'أحدث التقارير',
  'dashboard.noReports': 'لا توجد تقارير بعد', 'dashboard.clientFeedback': 'أحدث ملاحظات العملاء', 'dashboard.noFeedback': 'لا توجد ملاحظات بعد', 'dashboard.commented': 'علّق',
  'kpi.activeCampaigns': 'الحملات النشطة', 'kpi.pendingApprovals': 'الموافقات المعلّقة', 'kpi.openRequests': 'الطلبات المفتوحة', 'kpi.totalSpend': 'إجمالي الإنفاق',
  'kpi.totalClients': 'إجمالي العملاء', 'kpi.activeClients': 'العملاء النشطون', 'kpi.assignedClients': 'العملاء المسندون', 'kpi.assignedCampaigns': 'الحملات المسندة', 'kpi.pendingDeliverables': 'قيد الإنجاز',

  // ── المؤشرات ──
  'metric.spend': 'الإنفاق', 'metric.reach': 'الوصول', 'metric.impressions': 'مرات الظهور', 'metric.clicks': 'النقرات', 'metric.ctr': 'نسبة النقر CTR', 'metric.cpc': 'تكلفة النقرة CPC', 'metric.cpm': 'تكلفة الألف ظهور CPM',
  'metric.conversions': 'التحويلات', 'metric.conversionValue': 'قيمة التحويلات', 'metric.roas': 'العائد على الإنفاق ROAS',

  // ── العملاء ──
  'client.title': 'العميل', 'client.subtitle': 'الشركات التي تديرها.', 'client.search': 'ابحث عن عميل…', 'client.new': 'عميل جديد', 'client.edit': 'تعديل العميل', 'client.create': 'إنشاء العميل',
  'client.created': 'تم إنشاء العميل', 'client.updated': 'تم تحديث العميل', 'client.empty': 'لا يوجد عملاء', 'client.emptyHint': 'أنشئ أول عميل لتبدأ بإضافة الحملات.',
  'client.emptyTeamHint': 'لم يتم إسنادك إلى أي عميل بعد. تواصل مع المسؤول.', 'client.companyName': 'اسم الشركة', 'client.contactName': 'الشخص المسؤول',
  'client.uploadLogo': 'رفع الشعار', 'client.logoHint': 'صيغ PNG أو JPG أو WebP أو GIF بحجم أقصاه 2 ميغابايت.', 'client.logoFailed': 'تم حفظ العميل لكن تعذّر رفع الشعار.',
  'client.portalUsers': 'مستخدمو البوابة', 'client.portalUsersHint': 'الأشخاص الذين يمكنهم تسجيل الدخول لهذا العميل.', 'client.noUsers': 'لا يوجد مستخدمون بعد. أنشئ مستخدمًا من صفحة المستخدمين.',
  'client.assignedTeam': 'الفريق المسند', 'client.noTeam': 'لا يوجد أعضاء فريق مسندون.',

  // ── المستخدمون ──
  'user.subtitle': 'كل من يمكنه تسجيل الدخول.', 'user.search': 'ابحث بالاسم أو البريد…', 'user.allRoles': 'كل الأدوار', 'user.new': 'مستخدم جديد', 'user.edit': 'تعديل المستخدم', 'user.create': 'إنشاء المستخدم',
  'user.created': 'تم إنشاء المستخدم', 'user.updated': 'تم تحديث المستخدم', 'user.empty': 'لا يوجد مستخدمون', 'user.role': 'الدور', 'user.lastLogin': 'آخر دخول', 'user.never': 'لم يسجّل الدخول', 'user.you': 'أنت',
  'user.menu': 'قائمة الحساب', 'user.newPassword': 'كلمة مرور جديدة', 'user.newPasswordHint': 'اتركها فارغة للإبقاء على كلمة المرور الحالية.', 'user.passwordRules': '8 أحرف على الأقل، وتتضمن حروفًا وأرقامًا.',
  'user.assignedClients': 'العملاء المسندون', 'user.assignedClientsHint': 'يرى عضو الفريق كل ما يخص هؤلاء العملاء.',
  'user.assignedCampaigns': 'حملات محددة', 'user.assignedCampaignsHint': 'امنح الوصول إلى حملات فردية دون كشف بقية بيانات العميل.',

  // ── الحملات ──
  'campaign.subtitle': 'تابع كل حملة وميزانيتها ونتائجها.', 'campaign.search': 'ابحث عن حملة…', 'campaign.new': 'حملة جديدة', 'campaign.edit': 'تعديل الحملة', 'campaign.create': 'إنشاء الحملة',
  'campaign.created': 'تم إنشاء الحملة', 'campaign.updated': 'تم تحديث الحملة', 'campaign.deleted': 'تم حذف الحملة', 'campaign.empty': 'لا توجد حملات',
  'campaign.emptyHint': 'أنشئ حملة لأحد عملائك.', 'campaign.emptyRestrictedHint': 'ستظهر الحملات هنا فور إنشائها لك.',
  'campaign.name': 'اسم الحملة', 'campaign.platform': 'المنصة', 'campaign.objective': 'الهدف', 'campaign.status': 'الحالة', 'campaign.startDate': 'تاريخ البدء', 'campaign.endDate': 'تاريخ الانتهاء',
  'campaign.budget': 'الميزانية', 'campaign.spent': 'المُنفق', 'campaign.spentHint': 'يُحدَّث تلقائيًا من التقارير اليومية.', 'campaign.externalId': 'معرّف الحملة في المنصة',
  'campaign.externalIdHint': 'اختياري. يُستخدم لربط منصات الإعلانات مستقبلًا.', 'campaign.allPlatforms': 'كل المنصات', 'campaign.allObjectives': 'كل الأهداف',
  'campaign.budgetSpent': 'المُنفق / الميزانية', 'campaign.dates': 'التواريخ', 'campaign.tabOverview': 'نظرة عامة', 'campaign.details': 'تفاصيل الحملة',
  'campaign.noReportsYet': 'لا توجد بيانات أداء بعد. ستظهر الأرقام هنا عند إضافة التقارير اليومية.', 'campaign.ofBudget': 'من ميزانية {budget}', 'campaign.percentUsed': 'تم استهلاك {pct}% من الميزانية',
  'campaign.deleteTitle': 'حذف هذه الحملة؟', 'campaign.deleteMessage': 'سيتم حذف «{name}» وتقاريرها. تبقى المخرجات وسجل موافقاتها محفوظة.',

  // ── المخرجات والمراجعة ──
  'deliverable.subtitle': 'الأعمال الإبداعية من المسودة حتى الموافقة.', 'deliverable.search': 'ابحث عن مخرج…', 'deliverable.allTypes': 'كل الأنواع', 'deliverable.new': 'مخرج جديد',
  'deliverable.newHint': 'يُنشأ كمسودة. لا يظهر للعميل شيء حتى ترسله للموافقة.', 'deliverable.create': 'إنشاء المخرج', 'deliverable.edit': 'تعديل المخرج',
  'deliverable.created': 'تم إنشاء المخرج', 'deliverable.updated': 'تم تحديث المخرج', 'deliverable.empty': 'لا توجد مخرجات',
  'deliverable.emptyHint': 'أنشئ أول مخرج لبدء مسار الموافقة.', 'deliverable.emptyClientHint': 'تظهر المخرجات هنا عندما ترسلها الوكالة للموافقة.',
  'deliverable.name': 'اسم المخرج', 'deliverable.campaign': 'الحملة', 'deliverable.type': 'النوع', 'deliverable.dueDate': 'تاريخ التسليم', 'deliverable.previewUrl': 'رابط المعاينة',
  'deliverable.previewUrlHint': 'اختياري. رابط معاينة من Drive أو Figma أو فيديو (http أو https).', 'deliverable.descriptionPlaceholder': 'ما هذا المخرج، وما الذي يجب أن ينتبه إليه العميل؟',
  'review.approve': 'موافقة', 'review.requestChanges': 'طلب تعديلات', 'review.approveTitle': 'الموافقة على هذا المخرج؟', 'review.changesTitle': 'طلب تعديلات',
  'review.decisionFor': '{name} · النسخة {version}', 'review.commentOptional': 'تعليق (اختياري)', 'review.whatToChange': 'ما الذي يجب تعديله؟',
  'review.approveHint': 'تُسجَّل الموافقات بشكل دائم في السجل.', 'review.changesHint': 'كن محددًا ليتمكن الفريق من إنجاز كل التعديلات دفعة واحدة.',
  'review.approvePlaceholder': 'العمل رائع!', 'review.changesPlaceholder': 'مثال: كبّروا العنوان واستخدموا الشعار الأزرق.', 'review.sendChanges': 'إرسال الملاحظات',
  'review.approvedToast': 'تمت الموافقة، وتم إشعار الفريق.', 'review.changesToast': 'تم إرسال ملاحظاتك إلى الفريق.',
  'review.yourDecision': 'قرارك', 'review.yourDecisionHint': 'وافق عليه، أو أخبر الفريق بما يجب تعديله.',
  'review.history': 'سجل الموافقات', 'review.historyHint': 'كل إرسال وقرار بالترتيب. لا يتم استبدال السجلات أبدًا.', 'review.noHistory': 'لم يُرسل للموافقة بعد.',
  'review.tlSubmitted': 'أُرسل للموافقة', 'review.tlApproved': 'تمت الموافقة', 'review.tlChanges': 'طُلبت تعديلات', 'review.version': 'النسخة', 'review.versionN': 'النسخة {n}',
  'review.files': 'الملفات', 'review.openPreview': 'فتح المعاينة', 'review.changesRequestedBanner': 'تم طلب تعديلات', 'review.draftBanner': 'هذه مسودة. لا يستطيع العميل رؤيتها حتى ترسلها للموافقة.',
  'review.submitForApproval': 'إرسال للموافقة', 'review.submitTitle': 'إرسال إلى العميل؟', 'review.submitMessage': 'ستصبح النسخة {version} مرئية للعميل ولن يمكن تعديلها.',
  'review.submittedToast': 'تم الإرسال للموافقة', 'review.startNewVersion': 'إنشاء نسخة جديدة', 'review.newVersionTitle': 'بدء نسخة جديدة؟',
  'review.newVersionMessage': 'سيتم إنشاء مسودة جديدة (النسخة {version}) لتطبيق التعديلات المطلوبة. تبقى النسخ السابقة في السجل.', 'review.newVersionToast': 'تم إنشاء نسخة جديدة',
  'review.markPublished': 'تحديد كمنشور', 'review.publishTitle': 'تحديد كمنشور؟', 'review.publishMessage': 'استخدم هذا الخيار عندما يصبح العمل المعتمد قيد التشغيل في الحملة.', 'review.publishedToast': 'تم تحديده كمنشور',
  'review.uploadForVersion': 'رفع ملف للنسخة {n}',
  'review.comments': 'التعليقات', 'review.commentsHint': 'ابدأ المحادثة.', 'review.commentPlaceholder': 'اكتب تعليقًا…', 'review.addComment': 'إضافة تعليق', 'review.postComment': 'نشر التعليق',
  'review.authorClient': 'العميل', 'review.authorTeam': 'الفريق',

  // ── الموافقات ──
  'approvals.subtitle': 'كل ما ينتظر قرارًا، وكل قرار تم اتخاذه.', 'approvals.tabPending': 'بانتظار المراجعة', 'approvals.tabHistory': 'السجل',
  'approvals.nonePending': 'لا يوجد شيء بانتظار الموافقة', 'approvals.nonePendingClient': 'لقد أنجزت كل شيء. ستظهر الأعمال الجديدة هنا.', 'approvals.nonePendingStaff': 'ستظهر هنا المخرجات التي ترسلها للموافقة.',
  'approvals.review': 'مراجعة', 'approvals.view': 'عرض', 'approvals.submittedAgo': 'أُرسل {when}', 'approvals.allDecisions': 'كل القرارات', 'approvals.noHistory': 'لا توجد قرارات بعد',
  'approvals.noHistoryHint': 'ستُعرض هنا الموافقات وطلبات التعديل.', 'approvals.decision': 'القرار', 'approvals.comment': 'التعليق', 'approvals.by': 'بواسطة',

  // ── الطلبات ──
  'request.subtitle': 'اطلب أعمالًا جديدة وتابع تقدّمها.', 'request.search': 'ابحث عن طلب…', 'request.new': 'طلب جديد', 'request.newHint': 'أخبرنا بما تحتاجه وسنعود إليك قريبًا.',
  'request.submit': 'إرسال الطلب', 'request.created': 'تم إرسال الطلب', 'request.updated': 'تم تحديث الطلب', 'request.empty': 'لا توجد طلبات',
  'request.emptyHint': 'تحتاج تصميمًا أو فيديو أو نصًا جديدًا؟ أنشئ طلبًا.', 'request.emptyStaffHint': 'ستظهر هنا الطلبات التي ينشئها العملاء.',
  'request.title': 'العنوان', 'request.type': 'النوع', 'request.priority': 'الأولوية', 'request.campaign': 'الحملة', 'request.noCampaign': 'بدون حملة محددة', 'request.assignedTo': 'المسند إلى',
  'request.unassigned': 'غير مسند', 'request.dueDate': 'الموعد النهائي', 'request.completedAt': 'تاريخ الإنجاز', 'request.descriptionPlaceholder': 'صف ما تحتاجه: المقاسات والمراجع والمواعيد…',
  'request.attachment': 'مرفق', 'request.attachments': 'المرفقات', 'request.attach': 'إضافة مرفق', 'request.noAttachments': 'لا توجد مرفقات.',
  'request.attachmentFailed': 'تم إنشاء الطلب لكن تعذّر رفع المرفق.', 'request.details': 'التفاصيل', 'request.allPriorities': 'كل الأولويات', 'request.allTypes': 'كل الأنواع',
  'request.cancel': 'إلغاء الطلب', 'request.cancelTitle': 'إلغاء هذا الطلب؟', 'request.cancelMessage': 'سيتم إشعار الفريق بأنك لم تعد بحاجة إليه.', 'request.cancelConfirm': 'إلغاء الطلب',

  // ── التقارير ──
  'report.subtitle': 'الأداء من الأرقام اليومية الحقيقية.', 'report.new': 'إضافة تقرير', 'report.newHint': 'أدخل الأرقام الخام لحملة واحدة في يوم واحد.', 'report.save': 'حفظ التقرير',
  'report.created': 'تم حفظ التقرير', 'report.deleted': 'تم حذف التقرير', 'report.date': 'التاريخ', 'report.from': 'من', 'report.to': 'إلى', 'report.allCampaigns': 'كل الحملات',
  'report.last7': 'آخر 7 أيام', 'report.last30': 'آخر 30 يومًا', 'report.allTime': 'كل الفترات', 'report.empty': 'لا توجد بيانات تقارير', 'report.emptyHint': 'ستظهر الأرقام هنا عند إضافة التقارير اليومية.',
  'report.calculatedHint': 'تُحسب النسب CTR وCPC وCPM وROAS تلقائيًا.', 'report.chartSpend': 'الإنفاق عبر الزمن', 'report.chartClicks': 'النقرات عبر الزمن',
  'report.chartConversions': 'التحويلات عبر الزمن', 'report.chartRoas': 'العائد على الإنفاق عبر الزمن', 'report.daily': 'النتائج اليومية',
  'report.deleteTitle': 'حذف هذا التقرير؟', 'report.deleteMessage': 'سيتم حذف تقرير يوم {date} وإعادة حساب إنفاق الحملة.',

  // ── الملفات ──
  'file.subtitle': 'كل الملفات المشتركة بينك وبين الوكالة.', 'file.search': 'ابحث عن ملف…', 'file.allTypes': 'كل أنواع الملفات', 'file.kindImage': 'صور', 'file.kindVideo': 'فيديو',
  'file.kindDocument': 'مستندات', 'file.upload': 'رفع ملف', 'file.uploaded': 'تم رفع الملف', 'file.uploadDraftHint': 'تبقى الملفات مخفية عن العميل حتى تُرسل هذه النسخة للموافقة.',
  'file.choose': 'اختر ملفًا أو أفلته هنا', 'file.hint': 'صور وفيديو وPDF ومستندات. الحد الأقصى {mb} ميغابايت.', 'file.name': 'الملف', 'file.attachedTo': 'مرتبط بـ', 'file.uploadedBy': 'رفعه',
  'file.campaign': 'الحملة', 'file.visibility': 'الظهور', 'file.visible': 'يراه العميل', 'file.internal': 'داخلي', 'file.visibleToClient': 'مرئي للعميل', 'file.download': 'تنزيل',
  'file.empty': 'لا توجد ملفات بعد', 'file.emptyHint': 'ستُعرض هنا الملفات المرفوعة.', 'file.deleted': 'تم حذف الملف', 'file.deleteTitle': 'حذف هذا الملف؟', 'file.deleteMessage': 'سيتم حذف «{name}» نهائيًا.',
  'file.tooLarge': 'حجم هذا الملف أكبر من {mb} ميغابايت.', 'file.typeNotAllowed': 'نوع هذا الملف غير مسموح به.', 'file.emptyFile': 'هذا الملف فارغ.',

  // ── الإشعارات ──
  'notif.title': 'الإشعارات', 'notif.markAllRead': 'تحديد الكل كمقروء', 'notif.allRead': 'لا شيء جديد', 'notif.viewAll': 'عرض كل الإشعارات', 'notif.empty': 'لقد اطّلعت على كل شيء',
  'notif.emptyHint': 'ستظهر هنا الأنشطة الجديدة.', 'notif.filterAll': 'الكل', 'notif.filterUnread': 'غير المقروءة', 'notif.unreadCount': '{n} غير مقروء',
  'notif.NEW_REQUEST': 'أنشأ {by} طلبًا جديدًا: {title}', 'notif.DELIVERABLE_SUBMITTED': '«{name}» (النسخة {version}) جاهز لموافقتك', 'notif.DELIVERABLE_APPROVED': 'وافق {client} على «{name}» (النسخة {version})',
  'notif.CHANGES_REQUESTED': 'طلب {client} تعديلات على «{name}» (النسخة {version})', 'notif.REQUEST_STATUS_CHANGED': 'أصبحت حالة الطلب «{title}»: {status}', 'notif.REQUEST_ASSIGNED': 'تم إسناد الطلب «{title}» إليك',
  'notif.NEW_COMMENT': 'علّق {by} على «{name}»', 'notif.DELIVERABLE_PUBLISHED': 'تم نشر «{name}»',

  // ── الإعدادات ──
  'settings.title': 'الإعدادات', 'settings.subtitle': 'ملفك الشخصي واللغة والأمان.', 'settings.profile': 'الملف الشخصي', 'settings.profileSaved': 'تم تحديث الملف الشخصي',
  'settings.language': 'اللغة', 'settings.languageHint': 'اللغة العربية تحوّل الواجهة بالكامل من اليمين إلى اليسار.', 'settings.password': 'كلمة المرور', 'settings.passwordHint': 'تغييرها يُنهي جلساتك على الأجهزة الأخرى.',
  'settings.currentPassword': 'كلمة المرور الحالية', 'settings.newPassword': 'كلمة المرور الجديدة', 'settings.confirmPassword': 'تأكيد كلمة المرور الجديدة', 'settings.passwordMismatch': 'كلمتا المرور غير متطابقتين.',
  'settings.changePassword': 'تغيير كلمة المرور', 'settings.passwordChanged': 'تم تغيير كلمة المرور',

  // ── سجل النشاط ──
  'audit.subtitle': 'من فعل ماذا ومتى. مرئي للمسؤولين فقط.', 'audit.search': 'ابحث بمعرّف السجل أو التفاصيل…', 'audit.allActions': 'كل الإجراءات', 'audit.allEntities': 'كل السجلات',
  'audit.empty': 'لا يوجد نشاط', 'audit.action': 'الإجراء', 'audit.user': 'المستخدم', 'audit.entity': 'السجل', 'audit.details': 'التفاصيل', 'audit.when': 'الوقت', 'audit.system': 'النظام',

  // ── تسميات القيم ──
  'clientStatus.ACTIVE': 'نشط', 'clientStatus.PAUSED': 'متوقف مؤقتًا', 'clientStatus.ARCHIVED': 'مؤرشف',
  'userStatus.ACTIVE': 'نشط', 'userStatus.INACTIVE': 'غير نشط',
  'role.ADMIN': 'مسؤول', 'role.TEAM': 'فريق', 'role.CLIENT': 'عميل',
  'platform.META': 'ميتا', 'platform.GOOGLE': 'جوجل', 'platform.TIKTOK': 'تيك توك', 'platform.SNAPCHAT': 'سناب شات', 'platform.OTHER': 'أخرى',
  'objective.SALES': 'المبيعات', 'objective.LEADS': 'العملاء المحتملون', 'objective.TRAFFIC': 'الزيارات', 'objective.AWARENESS': 'الوعي بالعلامة', 'objective.ENGAGEMENT': 'التفاعل',
  'campaignStatus.PLANNING': 'قيد التخطيط', 'campaignStatus.PENDING_APPROVAL': 'بانتظار الموافقة', 'campaignStatus.RUNNING': 'قيد التشغيل', 'campaignStatus.PAUSED': 'متوقفة مؤقتًا', 'campaignStatus.COMPLETED': 'مكتملة',
  'deliverableType.DESIGN': 'تصميم', 'deliverableType.VIDEO': 'فيديو', 'deliverableType.REEL': 'ريلز', 'deliverableType.STORY': 'ستوري', 'deliverableType.COPY': 'نص إعلاني', 'deliverableType.BANNER': 'بانر', 'deliverableType.OTHER': 'أخرى',
  'deliverableStatus.DRAFT': 'مسودة', 'deliverableStatus.PENDING_APPROVAL': 'بانتظار الموافقة', 'deliverableStatus.APPROVED': 'تمت الموافقة', 'deliverableStatus.CHANGES_REQUESTED': 'مطلوب تعديلات', 'deliverableStatus.PUBLISHED': 'منشور',
  'decision.PENDING': 'معلّق', 'decision.APPROVED': 'تمت الموافقة', 'decision.CHANGES_REQUESTED': 'مطلوب تعديلات',
  'requestType.DESIGN': 'تصميم', 'requestType.VIDEO': 'فيديو', 'requestType.COPY': 'نص إعلاني', 'requestType.CAMPAIGN': 'حملة', 'requestType.OTHER': 'أخرى',
  'requestStatus.NEW': 'جديد', 'requestStatus.IN_PROGRESS': 'قيد التنفيذ', 'requestStatus.WAITING_CLIENT': 'بانتظار العميل', 'requestStatus.COMPLETED': 'مكتمل', 'requestStatus.CANCELLED': 'ملغى',
  'priority.LOW': 'منخفضة', 'priority.NORMAL': 'عادية', 'priority.HIGH': 'عالية', 'priority.URGENT': 'عاجلة',
  'auditEntity.user': 'مستخدم', 'auditEntity.client': 'عميل', 'auditEntity.campaign': 'حملة', 'auditEntity.deliverable': 'مخرج', 'auditEntity.request': 'طلب', 'auditEntity.report': 'تقرير', 'auditEntity.file': 'ملف',
  'auditAction.USER_LOGIN': 'تسجيل دخول', 'auditAction.USER_CREATED': 'إنشاء مستخدم', 'auditAction.USER_UPDATED': 'تحديث مستخدم', 'auditAction.USER_ASSIGNMENTS_UPDATED': 'تحديث الإسنادات', 'auditAction.PASSWORD_CHANGED': 'تغيير كلمة المرور',
  'auditAction.CLIENT_CREATED': 'إنشاء عميل', 'auditAction.CLIENT_UPDATED': 'تحديث عميل', 'auditAction.CLIENT_ARCHIVED': 'أرشفة عميل',
  'auditAction.CAMPAIGN_CREATED': 'إنشاء حملة', 'auditAction.CAMPAIGN_UPDATED': 'تحديث حملة', 'auditAction.CAMPAIGN_DELETED': 'حذف حملة',
  'auditAction.DELIVERABLE_CREATED': 'إنشاء مخرج', 'auditAction.DELIVERABLE_UPDATED': 'تحديث مخرج', 'auditAction.DELIVERABLE_SUBMITTED': 'إرسال للموافقة',
  'auditAction.DELIVERABLE_APPROVED': 'موافقة على مخرج', 'auditAction.CHANGES_REQUESTED': 'طلب تعديلات', 'auditAction.DELIVERABLE_NEW_VERSION': 'بدء نسخة جديدة', 'auditAction.DELIVERABLE_PUBLISHED': 'نشر مخرج',
  'auditAction.REQUEST_CREATED': 'إنشاء طلب', 'auditAction.REQUEST_UPDATED': 'تحديث طلب', 'auditAction.REQUEST_STATUS_CHANGED': 'تغيير حالة طلب',
  'auditAction.REPORT_CREATED': 'إضافة تقرير', 'auditAction.REPORT_DELETED': 'حذف تقرير', 'auditAction.FILE_UPLOADED': 'رفع ملف', 'auditAction.FILE_DELETED': 'حذف ملف', 'auditAction.COMMENT_CREATED': 'إضافة تعليق',

  // ── أخطاء الخادم ──
  'error.NETWORK_ERROR': 'تعذّر الوصول إلى الخادم. تحقق من اتصالك وحاول مرة أخرى.', 'error.INTERNAL_ERROR': 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى.', 'error.DATABASE_ERROR': 'حدث خطأ من جانبنا. يرجى المحاولة مرة أخرى.',
  'error.VALIDATION_ERROR': 'يرجى مراجعة الحقول المحددة.', 'error.INVALID_CREDENTIALS': 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'error.ACCOUNT_DISABLED': 'تم تعطيل هذا الحساب. تواصل مع المسؤول.',
  'error.TOO_MANY_ATTEMPTS': 'محاولات كثيرة. يرجى الانتظار بضع دقائق ثم المحاولة مرة أخرى.', 'error.UNAUTHENTICATED': 'انتهت جلستك. يرجى تسجيل الدخول مجددًا.', 'error.FORBIDDEN': 'لا تملك صلاحية تنفيذ هذا الإجراء.',
  'error.NOT_FOUND': 'تعذّر العثور على ما تبحث عنه.', 'error.INVALID_STATE': 'هذا الإجراء غير متاح في الحالة الحالية.', 'error.NOT_PENDING': 'لم يعد هذا العنصر بانتظار قرار.',
  'error.DELIVERABLE_LOCKED': 'يمكن تعديل المسودات فقط. ابدأ نسخة جديدة لإجراء تعديلات.', 'error.DELIVERABLE_EMPTY': 'أضف رابط معاينة أو وصفًا أو ملفًا قبل الإرسال للموافقة.',
  'error.REPORT_EXISTS': 'يوجد تقرير لهذه الحملة في هذا التاريخ بالفعل.', 'error.CANNOT_MODIFY_SELF': 'لا يمكنك تغيير دورك أو تعطيل حسابك بنفسك.',
  'error.ASSIGNMENTS_TEAM_ONLY': 'يمكن إسناد العملاء أو الحملات إلى أعضاء الفريق فقط.', 'error.CLIENT_CHANGE_NOT_ALLOWED': 'لا يمكن نقل الحملة إلى عميل آخر.',
  'error.FILE_REQUIRED': 'يرجى اختيار ملف.', 'error.FILE_EMPTY': 'هذا الملف فارغ.', 'error.FILE_TOO_LARGE': 'حجم هذا الملف كبير جدًا.', 'error.LIMIT_FILE_SIZE': 'حجم هذا الملف كبير جدًا.',
  'error.FILE_TYPE_NOT_ALLOWED': 'نوع هذا الملف غير مسموح به.', 'error.FILE_CONTENT_MISMATCH': 'محتوى الملف لا يطابق نوعه.', 'error.UPLOAD_FAILED': 'فشل الرفع. يرجى المحاولة مرة أخرى.',
  'error.PAYLOAD_TOO_LARGE': 'الطلب كبير جدًا.', 'error.INVALID_JSON': 'تعذّرت قراءة الطلب.', 'error.CONFLICT': 'يتعارض هذا مع بيانات موجودة.',

  // ── التحقق من الحقول ──
  'validation.invalid': 'هذه القيمة غير صالحة.', 'validation.required': 'هذا الحقل مطلوب.', 'validation.invalid_email': 'أدخل عنوان بريد إلكتروني صالحًا.', 'validation.too_short': 'القيمة قصيرة جدًا.',
  'validation.too_long': 'القيمة طويلة جدًا.', 'validation.too_small': 'الرقم صغير جدًا.', 'validation.too_big': 'الرقم كبير جدًا.', 'validation.invalid_url': 'أدخل رابطًا صالحًا يبدأ بـ http:// أو https://.',
  'validation.invalid_choice': 'يرجى اختيار خيار صالح.', 'validation.not_allowed': 'هذا غير مسموح به.', 'validation.email_taken': 'هذا البريد الإلكتروني مستخدم في حساب آخر.',
  'validation.password_too_short': 'استخدم 8 أحرف على الأقل.', 'validation.password_weak': 'استخدم حروفًا وأرقامًا معًا.', 'validation.wrong_password': 'كلمة المرور الحالية غير صحيحة.',
  'validation.invalid_date': 'أدخل تاريخًا صالحًا.', 'validation.date_in_future': 'لا يمكن أن يكون التاريخ في المستقبل.', 'validation.end_before_start': 'يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.',
  'validation.campaign_client_mismatch': 'هذه الحملة لا تتبع العميل المحدد.',
};
