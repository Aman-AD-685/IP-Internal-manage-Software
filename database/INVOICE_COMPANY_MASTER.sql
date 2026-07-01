-- =============================================================================
-- Invoice company master — Add / Edit Invoice "Company Name" dropdown
-- Run in Supabase SQL Editor (safe to re-run).
-- Requires: public.companies (id uuid, name text UNIQUE)
-- Backend: GET /companies/for-invoice
-- =============================================================================

INSERT INTO public.companies (name)
SELECT trim(v)
FROM (
  VALUES
    ('Agrawal Sponge Pvt. Ltd.'),
    ('Amiya Steel Pvt. Ltd.'),
    ('Indo East Corporation Pvt. Ltd.'),
    ('Sri Venkatesh Iron & Alloys (India) Ltd.'),
    ('Anjanisuta Steels Pvt. Ltd.'),
    ('Balajee Mini Steels & Re Rolling Pvt. Ltd.'),
    ('Balmukund Sponge Iron Pvt. Ltd.'),
    ('Balmukund Cement & Roofing (P) Ltd.'),
    ('Bharat Hitech (Cements) Pvt Ltd'),
    ('Black Rock Steels Pvt Ltd'),
    ('B. R Sponge & Power Ltd.'),
    ('Maa Mangla Ispat Pvt. Ltd.'),
    ('Maa Shakambari Steel Ltd.'),
    ('Maa Mangla Ispat Pvt. Ltd. (Unit-2)'),
    ('B R Refinery LLP'),
    ('GM Iron & Steel Company Limited Badampahar'),
    ('Crescent Foundry Co Pvt.Ltd.'),
    ('Dadiji Steels Manufacture & Trade Pvt Ltd'),
    ('Niranjan Metallic Limited'),
    ('Dhanbad Fuels Ltd.'),
    ('Hitech Plastochem Udyog Pvt. Ltd.'),
    ('Maan Concast Pvt. Ltd.'),
    ('Maan Steel & Power Ltd.'),
    ('Mark Steels P Ltd.'),
    ('Singhal Enterprises(Jharsuguda)Pvt Ltd'),
    ('MVK Industries Pvt. Ltd.'),
    ('Pratishtha Polypack Pvt. Ltd.'),
    ('Pratishtha Spirits Pvt. Ltd'),
    ('Rausheena Udyog Ltd.'),
    ('Shakambari Overseas Trade Pvt. Ltd.'),
    ('Spintech Tubes Pvt. Ltd.'),
    ('Suprime Cement Pvt. Ltd.'),
    ('Shree Parashnath Re-Roolling Mills Ltd.'),
    ('Govinda Polytex India Pvt. Ltd.'),
    ('Shri Varu Polytex Pvt. Ltd.'),
    ('Sky Alloys and Power Pvt Ltd'),
    ('Sky Steel & Power Pvt. Ltd'),
    ('Ugen Ferro Alloys Pvt. Ltd.'),
    ('Surendra Mining Industries Pvt. Ltd.'),
    ('Vishal Metalliks'),
    ('Vraj Metaliks Pvt. Ltd.'),
    ('Gopal Sponge & Power Pvt. Ltd.'),
    ('Maruti Ferro'),
    ('Ghankun Steels Pvt Ltd'),
    ('Sunil Ispat & Power Pvt Ltd'),
    ('HSR'),
    ('Karni Kripa Power Pvt Ltd.'),
    ('Nutan Ispat & Power Ltd'),
    ('Hariom Ingots'),
    ('Epoxy (Hariom Coating)'),
    ('Hi-Tech Power & Steel Ltd.'),
    ('Jay Iron & Steels Ltd.'),
    ('Meta Sponge'),
    ('Plascom Industries LLP'),
    ('Flexicom Industries Pvt. Ltd.'),
    ('Salagram Power'),
    ('Big Mint'),
    ('Super Iron Foundry'),
    ('Orissa Concrete & Allied Industries Ltd'),
    ('GP Wire & Metals LLP'),
    ('H R Ispat Pvt. Ltd.'),
    ('Shambhavi Ispat Pvt. Ltd.'),
    ('Vaswani Industries Limited'),
    ('Govind Steel & Co. Ltd'),
    ('Dinesh Brothers Pvt. Ltd.'),
    ('Orissa Concrete & Allied Industries Ltd. Raipur'),
    ('Kodarma Chemicals Ltd.'),
    ('Kodarma Petrochemicals Pvt. Ltd.'),
    ('Roopgarh Power & Alloys Ltd.'),
    ('Mangal Sponge & Steel Pvt. Ltd.'),
    ('Brahmaputra Metallics Ltd.'),
    ('Vighneshwar Ispat Pvt. Ltd.'),
    ('Shilphy Steels Pvt. Ltd.'),
    ('Bihar Foundry & Casting Limited'),
    ('Utkal Hydrocarbon Pvt. Ltd.'),
    ('Kedia Carbon Pvt. Ltd.'),
    ('Ferro Metals')
) AS t(v)
WHERE trim(v) <> ''
ON CONFLICT (name) DO NOTHING;

-- Preview: each master name should match a companies row (normalized)
WITH master AS (
  SELECT trim(v) AS expected_name
  FROM (
    VALUES
      ('Agrawal Sponge Pvt. Ltd.'),
      ('Amiya Steel Pvt. Ltd.'),
      ('Indo East Corporation Pvt. Ltd.'),
      ('Sri Venkatesh Iron & Alloys (India) Ltd.'),
      ('Anjanisuta Steels Pvt. Ltd.'),
      ('Balajee Mini Steels & Re Rolling Pvt. Ltd.'),
      ('Balmukund Sponge Iron Pvt. Ltd.'),
      ('Balmukund Cement & Roofing (P) Ltd.'),
      ('Bharat Hitech (Cements) Pvt Ltd'),
      ('Black Rock Steels Pvt Ltd'),
      ('B. R Sponge & Power Ltd.'),
      ('Maa Mangla Ispat Pvt. Ltd.'),
      ('Maa Shakambari Steel Ltd.'),
      ('Maa Mangla Ispat Pvt. Ltd. (Unit-2)'),
      ('B R Refinery LLP'),
      ('GM Iron & Steel Company Limited Badampahar'),
      ('Crescent Foundry Co Pvt.Ltd.'),
      ('Dadiji Steels Manufacture & Trade Pvt Ltd'),
      ('Niranjan Metallic Limited'),
      ('Dhanbad Fuels Ltd.'),
      ('Hitech Plastochem Udyog Pvt. Ltd.'),
      ('Maan Concast Pvt. Ltd.'),
      ('Maan Steel & Power Ltd.'),
      ('Mark Steels P Ltd.'),
      ('Singhal Enterprises(Jharsuguda)Pvt Ltd'),
      ('MVK Industries Pvt. Ltd.'),
      ('Pratishtha Polypack Pvt. Ltd.'),
      ('Pratishtha Spirits Pvt. Ltd'),
      ('Rausheena Udyog Ltd.'),
      ('Shakambari Overseas Trade Pvt. Ltd.'),
      ('Spintech Tubes Pvt. Ltd.'),
      ('Suprime Cement Pvt. Ltd.'),
      ('Shree Parashnath Re-Roolling Mills Ltd.'),
      ('Govinda Polytex India Pvt. Ltd.'),
      ('Shri Varu Polytex Pvt. Ltd.'),
      ('Sky Alloys and Power Pvt Ltd'),
      ('Sky Steel & Power Pvt. Ltd'),
      ('Ugen Ferro Alloys Pvt. Ltd.'),
      ('Surendra Mining Industries Pvt. Ltd.'),
      ('Vishal Metalliks'),
      ('Vraj Metaliks Pvt. Ltd.'),
      ('Gopal Sponge & Power Pvt. Ltd.'),
      ('Maruti Ferro'),
      ('Ghankun Steels Pvt Ltd'),
      ('Sunil Ispat & Power Pvt Ltd'),
      ('HSR'),
      ('Karni Kripa Power Pvt Ltd.'),
      ('Nutan Ispat & Power Ltd'),
      ('Hariom Ingots'),
      ('Epoxy (Hariom Coating)'),
      ('Hi-Tech Power & Steel Ltd.'),
      ('Jay Iron & Steels Ltd.'),
      ('Meta Sponge'),
      ('Plascom Industries LLP'),
      ('Flexicom Industries Pvt. Ltd.'),
      ('Salagram Power'),
      ('Big Mint'),
      ('Super Iron Foundry'),
      ('Orissa Concrete & Allied Industries Ltd'),
      ('GP Wire & Metals LLP'),
      ('H R Ispat Pvt. Ltd.'),
      ('Shambhavi Ispat Pvt. Ltd.'),
      ('Vaswani Industries Limited'),
      ('Govind Steel & Co. Ltd'),
      ('Dinesh Brothers Pvt. Ltd.'),
      ('Orissa Concrete & Allied Industries Ltd. Raipur'),
      ('Kodarma Chemicals Ltd.'),
      ('Kodarma Petrochemicals Pvt. Ltd.'),
      ('Roopgarh Power & Alloys Ltd.'),
      ('Mangal Sponge & Steel Pvt. Ltd.'),
      ('Brahmaputra Metallics Ltd.'),
      ('Vighneshwar Ispat Pvt. Ltd.'),
      ('Shilphy Steels Pvt. Ltd.'),
      ('Bihar Foundry & Casting Limited'),
      ('Utkal Hydrocarbon Pvt. Ltd.'),
      ('Kedia Carbon Pvt. Ltd.'),
      ('Ferro Metals')
  ) AS t(v)
),
norm AS (
  SELECT
    expected_name,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(expected_name, ''), '[-–—]', ' ', 'g'),
              '[()\[\]{}]', ' ',
              'g'
            ),
            '[.,]', ' ',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS nk
  FROM master
)
SELECT
  m.expected_name,
  c.id AS company_id,
  c.name AS matched_in_db,
  CASE WHEN c.id IS NULL THEN 'MISSING — check spelling or alias' ELSE 'ok' END AS status
FROM norm m
LEFT JOIN LATERAL (
  SELECT id, name
  FROM public.companies c
  WHERE lower(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(coalesce(c.name, ''), '[-–—]', ' ', 'g'),
            '[()\[\]{}]', ' ',
            'g'
          ),
          '[.,]', ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      )
    )
  ) = m.nk
  LIMIT 1
) c ON true
ORDER BY m.expected_name;

NOTIFY pgrst, 'reload schema';
