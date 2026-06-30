import csv
with open("/home/romina/annotation-plataform/sample_import.csv", encoding="utf-8-sig") as f:
    rows = list(csv.DictReader(f))
print("Columnas detectadas:", list(rows[0].keys()))
print("Total columnas:", len(rows[0].keys()))
print("content[:200] =", repr(rows[0].get("content"))[:200])