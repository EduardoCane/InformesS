INSERT INTO public.report_formats (name, description, schema_json)
VALUES
(
  'Normal',
  'Formato base del informe.',
  '[
    {"id":"normal-initial-description","label":"Descripcion inicial","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":null},
    {"id":"normal-labor","label":"Labor","type":"text","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"normal-position","label":"Puesto","type":"text","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"normal-observations","label":"Observaciones","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"normal-recommendations","label":"Recomendaciones","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"normal-images","label":"Imagenes","type":"image","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"normal-final-conclusions","label":"Conclusiones y recomendaciones","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":null}
  ]'::jsonb
),
(
  'Completo',
  'Formato completo del informe.',
  '[
    {"id":"completo-initial-description","label":"Descripcion inicial","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":null},
    {"id":"completo-area","label":"Area","type":"text","options":[],"required":true,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"completo-responsable","label":"Responsable","type":"text","options":[],"required":true,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"completo-harness-line","label":"Serie de arnes|Linea vida","type":"text","options":[],"required":true,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"completo-production-date","label":"Fecha de Produccion","type":"text","options":[],"required":true,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"completo-observations","label":"Observaciones","type":"textarea","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"},
    {"id":"completo-images","label":"Fotos","type":"image","options":[],"required":false,"isResultField":false,"repeatableGroup":"activity-block"}
  ]'::jsonb
);