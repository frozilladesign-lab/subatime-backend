-- Extra notification kinds for morning / evening / night nudges (same day, different schedule).
ALTER TYPE "NotificationType" ADD VALUE 'daily_evening';
ALTER TYPE "NotificationType" ADD VALUE 'daily_night';
