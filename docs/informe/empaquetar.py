"""Empaqueta únicamente el informe y sus recursos públicos para la entrega."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

folder = Path(__file__).resolve().parent
docs = folder.parent
files = [docs / 'informe_final_iot_2026.tex', docs / 'informe_final_iot_2026.pdf', docs / 'mysql-schema.sql', docs / 'mysql.md', folder / 'README.md', folder / 'datos.tex']
for name in ('figuras', 'evidencias', 'creditos'):
    files.extend(p for p in (folder / name).rglob('*') if p.is_file())
with ZipFile(docs / 'mining-system-informe.zip', 'w', compression=ZIP_DEFLATED) as archive:
    for path in sorted(files):
        archive.write(path, path.relative_to(docs))
print(f'Paquete listo: {len(files)} archivos del informe; no incluye datos ni credenciales de la aplicación.')
