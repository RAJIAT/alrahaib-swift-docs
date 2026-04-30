-- 1. Add supervisor role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'supervisor';