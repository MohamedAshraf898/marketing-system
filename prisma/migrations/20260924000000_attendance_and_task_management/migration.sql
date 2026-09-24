-- CreateTable
CREATE TABLE "Space" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "clientId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Space_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Folder_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Folder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "folderId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskList_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskList_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskList_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskStatusOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#71717a',
    "category" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskStatusOption_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#71717a',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TaskTagLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    CONSTRAINT "TaskTagLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskTagLink_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TaskTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCustomField" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskCustomField_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskCustomFieldValue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskCustomFieldValue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskCustomFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "TaskCustomField" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'BLOCKS',
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskDependency_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TaskDependency_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "taskTitle" TEXT NOT NULL,
    "taskDescription" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "estimatedHours" REAL,
    "checklist" TEXT,
    "tags" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TaskTemplateItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "estimatedHours" REAL,
    "dueOffsetDays" INTEGER,
    CONSTRAINT "TaskTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskRecurrence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" TEXT,
    "monthDay" INTEGER,
    "nextDate" DATETIME NOT NULL,
    "endDate" DATETIME,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TaskRecurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TaskAutomation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "spaceId" TEXT,
    "listId" TEXT,
    "trigger" TEXT NOT NULL,
    "triggerStatus" TEXT,
    "action" TEXT NOT NULL,
    "config" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" DATETIME,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "workDays" TEXT NOT NULL DEFAULT '1,2,3,4,5',
    "startTime" TEXT NOT NULL DEFAULT '09:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "graceMinutes" INTEGER NOT NULL DEFAULT 10,
    "minimumMinutes" INTEGER NOT NULL DEFAULT 240,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "scheduleId" TEXT,
    "checkInAt" DATETIME,
    "checkOutAt" DATETIME,
    "remote" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL,
    "statusLocked" BOOLEAN NOT NULL DEFAULT false,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "expectedMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyLeaveMinutes" INTEGER NOT NULL DEFAULT 0,
    "overtimeMinutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "correctedById" TEXT,
    "correctedAt" DATETIME,
    "leaveRequestId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attendance_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "WorkSchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Attendance_correctedById_fkey" FOREIGN KEY ("correctedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Attendance_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "LeaveRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AttendanceBreak" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attendanceId" TEXT NOT NULL,
    "startAt" DATETIME NOT NULL,
    "endAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendanceBreak_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" DATETIME,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LeaveRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AlterTable (in place, like the phase-2 migration: no table rebuilds, existing rows keep their data)
ALTER TABLE "User" ADD COLUMN "workScheduleId" TEXT REFERENCES "WorkSchedule" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD COLUMN "trackAttendance" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "listId" TEXT REFERENCES "TaskList" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "depth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "position" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN "startDate" DATETIME;
ALTER TABLE "Task" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "Task" ADD COLUMN "reviewerId" TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "deliverableId" TEXT REFERENCES "Deliverable" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "requestId" TEXT REFERENCES "Request" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "customStatusId" TEXT REFERENCES "TaskStatusOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "blockOnDependencies" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "Task" ADD COLUMN "recurrenceSourceId" TEXT REFERENCES "Task" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "occurrenceDate" DATETIME;

-- AlterTable
ALTER TABLE "TaskComment" ADD COLUMN "editedAt" DATETIME;
ALTER TABLE "TaskComment" ADD COLUMN "authorType" TEXT NOT NULL DEFAULT 'TEAM';
ALTER TABLE "TaskComment" ADD COLUMN "clientVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TaskComment" ADD COLUMN "mentions" TEXT;
ALTER TABLE "TaskComment" ADD COLUMN "attachmentIds" TEXT;

-- CreateIndex
CREATE INDEX "Task_listId_status_position_idx" ON "Task"("listId", "status", "position");
CREATE INDEX "Task_parentId_position_idx" ON "Task"("parentId", "position");
CREATE INDEX "Task_startDate_idx" ON "Task"("startDate");
CREATE INDEX "Task_archivedAt_idx" ON "Task"("archivedAt");
CREATE INDEX "Task_clientId_visibility_idx" ON "Task"("clientId", "visibility");
CREATE INDEX "Task_deliverableId_idx" ON "Task"("deliverableId");
CREATE INDEX "Task_requestId_idx" ON "Task"("requestId");
CREATE INDEX "Task_reviewerId_idx" ON "Task"("reviewerId");
CREATE UNIQUE INDEX "Task_recurrenceSourceId_occurrenceDate_key" ON "Task"("recurrenceSourceId", "occurrenceDate");
CREATE INDEX "TaskComment_taskId_clientVisible_idx" ON "TaskComment"("taskId", "clientVisible");

-- CreateIndex
CREATE INDEX "Space_position_idx" ON "Space"("position");

-- CreateIndex
CREATE INDEX "Space_clientId_idx" ON "Space"("clientId");

-- CreateIndex
CREATE INDEX "Folder_spaceId_position_idx" ON "Folder"("spaceId", "position");

-- CreateIndex
CREATE INDEX "Folder_projectId_idx" ON "Folder"("projectId");

-- CreateIndex
CREATE INDEX "TaskList_spaceId_folderId_position_idx" ON "TaskList"("spaceId", "folderId", "position");

-- CreateIndex
CREATE INDEX "TaskList_projectId_idx" ON "TaskList"("projectId");

-- CreateIndex
CREATE INDEX "TaskStatusOption_spaceId_position_idx" ON "TaskStatusOption"("spaceId", "position");

-- CreateIndex
CREATE INDEX "TaskAssignee_userId_idx" ON "TaskAssignee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_userId_key" ON "TaskAssignee"("taskId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTag_name_key" ON "TaskTag"("name");

-- CreateIndex
CREATE INDEX "TaskTagLink_tagId_idx" ON "TaskTagLink"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTagLink_taskId_tagId_key" ON "TaskTagLink"("taskId", "tagId");

-- CreateIndex
CREATE INDEX "TaskCustomField_spaceId_position_idx" ON "TaskCustomField"("spaceId", "position");

-- CreateIndex
CREATE INDEX "TaskCustomFieldValue_fieldId_idx" ON "TaskCustomFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskCustomFieldValue_taskId_fieldId_key" ON "TaskCustomFieldValue"("taskId", "fieldId");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnId_key" ON "TaskDependency"("taskId", "dependsOnId");

-- CreateIndex
CREATE INDEX "TaskTemplate_name_idx" ON "TaskTemplate"("name");

-- CreateIndex
CREATE INDEX "TaskTemplateItem_templateId_position_idx" ON "TaskTemplateItem"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "TaskRecurrence_taskId_key" ON "TaskRecurrence"("taskId");

-- CreateIndex
CREATE INDEX "TaskRecurrence_active_nextDate_idx" ON "TaskRecurrence"("active", "nextDate");

-- CreateIndex
CREATE INDEX "TaskAutomation_enabled_trigger_idx" ON "TaskAutomation"("enabled", "trigger");

-- CreateIndex
CREATE INDEX "Attendance_date_status_idx" ON "Attendance"("date", "status");

-- CreateIndex
CREATE INDEX "Attendance_leaveRequestId_idx" ON "Attendance"("leaveRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_userId_date_key" ON "Attendance"("userId", "date");

-- CreateIndex
CREATE INDEX "AttendanceBreak_attendanceId_startAt_idx" ON "AttendanceBreak"("attendanceId", "startAt");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE INDEX "LeaveRequest_userId_startDate_idx" ON "LeaveRequest"("userId", "startDate");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_startDate_idx" ON "LeaveRequest"("status", "startDate");



-- ───────────── data ─────────────

-- every existing assignee becomes a TaskAssignee row (multiple assignees keep the old single one as primary)
INSERT INTO "TaskAssignee" ("id", "taskId", "userId", "createdAt")
SELECT 'ta_' || "id", "id", "assignedToId", CURRENT_TIMESTAMP FROM "Task" WHERE "assignedToId" IS NOT NULL;

-- manual ordering starts from the creation order
UPDATE "Task" SET "position" = COALESCE(CAST(strftime('%s', "createdAt") AS REAL), 0);

-- attendance roster: team members by default, administrators opt in from the attendance settings
UPDATE "User" SET "trackAttendance" = false WHERE "role" <> 'TEAM';

-- one default schedule (Mon-Fri 09:00-17:00 UTC) - administrators adjust it in Attendance > Schedules
INSERT INTO "WorkSchedule" ("id", "name", "timezone", "workDays", "startTime", "endTime", "breakMinutes", "graceMinutes", "minimumMinutes", "isDefault", "createdAt", "updatedAt")
VALUES ('default_schedule', 'Standard', 'UTC', '1,2,3,4,5', '09:00', '17:00', 60, 10, 240, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- the product is now called Famolya (a custom agency name set by an administrator is kept)
UPDATE "AppSettings" SET "agencyName" = 'Famolya' WHERE "agencyName" = 'OG System';
