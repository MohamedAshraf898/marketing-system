// Arabic strings of the 'insights' feature group. Must contain every key of insights.en.ts (TypeScript enforces it).
import type { insightsEn } from './insights.en';

export const insightsAr: Record<keyof typeof insightsEn, string> = {
  // global search
  'insights.search.placeholder': 'ابحث في كل شيء…',
  'insights.search.subtitle': 'العملاء، المشاريع، المهام، الحملات، المحتوى، الملفات وغيرها.',
  'insights.search.hint': 'ابدأ الكتابة بحرفين على الأقل.',
  'insights.search.minChars': 'اكتب حرفين على الأقل للبحث.',
  'insights.search.noResults': 'لا توجد نتائج لـ "{q}"',
  'insights.search.viewAll': 'عرض كل نتائج "{q}"',

  // unified calendar
  'insights.calendar.subtitle': 'كل تاريخ استحقاق ووقت نشر وتجديد في مكان واحد.',
  'insights.calendar.empty': 'لا شيء لعرضه في التقويم',
  'insights.calendar.emptyHint': 'ليست لديك صلاحية الوصول إلى أي مصدر تقويم بعد.',
  'insights.calendar.truncated': 'يتم عرض أول النتائج لهذه الفترة - ضيّق فلاتر النوع أو نطاق التاريخ لرؤية المزيد.',

  // period comparison
  'insights.compare.title': 'مقارنة الفترات',
  'insights.compare.subtitle': 'مقابل {from} – {to}',
  'insights.compare.previous': 'السابقة',
  'insights.compare.current': 'الحالية',
  'insights.compare.toggle': 'مقارنة بالفترة السابقة',
  'insights.compare.needsRange': 'اختر نطاق تاريخ (من/إلى) لمقارنة الفترات.',

  // print / PDF report
  'insights.print.action': 'طباعة / PDF',
  'insights.print.button': 'طباعة أو حفظ كملف PDF',
  'insights.print.previewHint': 'معاينة الطباعة - استخدم الزر لفتح نافذة الطباعة، ثم اختر "حفظ كـ PDF" إذا احتجت ذلك.',
  'insights.print.title': 'تقرير الأداء',
  'insights.print.generated': 'تم الإنشاء {at} بواسطة {by}',
  'insights.print.truncated': 'يتم عرض أول 100 صف يومي من إجمالي {n}. استخدم تصدير CSV للحصول على البيانات كاملة.',

  // search result type labels (label('searchType', value))
  'searchType.client': 'العملاء',
  'searchType.contact': 'جهات الاتصال',
  'searchType.project': 'المشاريع',
  'searchType.task': 'المهام',
  'searchType.campaign': 'الحملات',
  'searchType.deliverable': 'التسليمات',
  'searchType.content': 'المحتوى',
  'searchType.request': 'الطلبات',
  'searchType.file': 'الملفات',
  'searchType.invoice': 'الفواتير',
  'searchType.contract': 'العقود',

  // calendar source filter chip labels (label('calendarSource', value))
  'calendarSource.task': 'المهام',
  'calendarSource.project': 'المشاريع',
  'calendarSource.content': 'المحتوى',
  'calendarSource.campaign': 'الحملات',
  'calendarSource.deliverable': 'التسليمات',
  'calendarSource.invoice': 'الفواتير',
  'calendarSource.contract': 'العقود',
  'calendarSource.client': 'تواريخ انتهاء العقد',
};
