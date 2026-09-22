// English strings of the 'insights' feature group (search, calendar, reports/analytics). Keys must be unique across
// ALL p2 files: every key is prefixed 'insights.', except the enum-label groups 'searchType.*' / 'calendarSource.*'
// (used by label(group, value)) which do not exist in core.en.ts or any other group's file.
export const insightsEn = {
  // global search
  'insights.search.placeholder': 'Search everything…',
  'insights.search.subtitle': 'Clients, projects, tasks, campaigns, content, files and more.',
  'insights.search.hint': 'Start typing at least 2 characters.',
  'insights.search.minChars': 'Type at least 2 characters to search.',
  'insights.search.noResults': 'No results for "{q}"',
  'insights.search.viewAll': 'View all results for "{q}"',

  // unified calendar
  'insights.calendar.subtitle': 'Every due date, publish time and renewal in one place.',
  'insights.calendar.empty': 'Nothing to show on the calendar',
  'insights.calendar.emptyHint': 'You do not have access to any calendar source yet.',
  'insights.calendar.truncated': 'Showing the first results for this range - narrow the type filters or the date range to see more.',

  // period comparison
  'insights.compare.title': 'Compare periods',
  'insights.compare.subtitle': 'vs. {from} – {to}',
  'insights.compare.previous': 'Previous',
  'insights.compare.current': 'Current',
  'insights.compare.toggle': 'Compare to previous period',
  'insights.compare.needsRange': 'Pick a from/to date range to compare periods.',

  // print / PDF report
  'insights.print.action': 'Print / PDF',
  'insights.print.button': 'Print or save as PDF',
  'insights.print.previewHint': 'Print preview - use the button to open the print dialog, then choose "Save as PDF" if needed.',
  'insights.print.title': 'Performance report',
  'insights.print.generated': 'Generated {at} by {by}',
  'insights.print.truncated': 'Showing the first 100 of {n} daily rows. Use CSV export for the complete dataset.',

  // search result type labels (label('searchType', value))
  'searchType.client': 'Clients',
  'searchType.contact': 'Contacts',
  'searchType.project': 'Projects',
  'searchType.task': 'Tasks',
  'searchType.campaign': 'Campaigns',
  'searchType.deliverable': 'Deliverables',
  'searchType.content': 'Content',
  'searchType.request': 'Requests',
  'searchType.file': 'Files',
  'searchType.invoice': 'Invoices',
  'searchType.contract': 'Contracts',

  // calendar source filter chip labels (label('calendarSource', value))
  'calendarSource.task': 'Tasks',
  'calendarSource.project': 'Projects',
  'calendarSource.content': 'Content',
  'calendarSource.campaign': 'Campaigns',
  'calendarSource.deliverable': 'Deliverables',
  'calendarSource.invoice': 'Invoices',
  'calendarSource.contract': 'Contracts',
  'calendarSource.client': 'Contract end dates',
} as const;
