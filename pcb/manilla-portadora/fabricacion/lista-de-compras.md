# Lista de compras — placa portadora v1

Para **una** placa. En los componentes SMD pequeños conviene comprar unos
cuantos de repuesto, porque se pierden al soldar.
Tamaños: 0805 = 2,0 × 1,25 mm; 1206 = 3,2 × 1,6 mm.

## Chips y semiconductores

| Cant. | Componente | Encapsulado | Referencias | Equivalentes / notas |
| --- | --- | --- | --- | --- |
| 1 | TP4056 (cargador LiPo 1 A) | SOP‑8 con almohadilla (ESOP‑8) | U1 | Soldar la almohadilla por las vías térmicas desde abajo |
| 1 | DW01A (protección de batería) | SOT‑23‑6 | U2 | Viene en los módulos TP4056 "con protección" |
| 1 | MT3608 (elevador a 5 V) | SOT‑23‑6 | U3 | Viene en los módulos MT3608 |
| 3 | AO3400A (MOSFET N) | SOT‑23 | Q1, Q2, Q5 | Marcado "A09T" |
| 1 | AO3401A (MOSFET P) | SOT‑23 | Q3 | Marcado "A19T" |
| 1 | MMBT3904 (NPN) | SOT‑23 | Q4 | S8050 SMD (J3Y) o MMBT2222A (1P), mismo orden de pines |
| 2 | SS14 (Schottky 1 A) | SMA | D3, D8 | |
| 2 | SS34 (Schottky 3 A) | SMA | D4, D5 | |
| 1 | 1N4148W | SOD‑123 | D7 | |
| 1 | LED rojo | 0805 | D1 | Cargando |
| 1 | LED verde | 0805 | D2 | Carga completa |
| 1 | LED RGB 5 mm, **cátodo común**, 4 patas | THT | D6 | Orden R‑K‑G‑B (la pata larga es el cátodo) |

## Pasivos

| Cant. | Valor | Encapsulado | Referencias |
| --- | --- | --- | --- |
| 2 | 47 Ω | 0805 | R19, R20 |
| 2 | 100 Ω | 0805 | R8, R23 |
| 1 | 120 Ω | 0805 | R18 |
| 4 | 1 kΩ | 0805 | R4, R5, R9, R21 |
| 1 | 2,2 kΩ | 0805 | R3 (fija la carga en ~545 mA) |
| 2 | 4,7 kΩ | 0805 | R15, R16 |
| 2 | 5,1 kΩ | 0805 | R1, R2 (USB‑C) |
| 2 | 10 kΩ | 0805 | R12, R22 |
| 1 | 15 kΩ | 0805 | R6 |
| 1 | 22 kΩ | 0805 | R7 |
| 1 | 75 kΩ | 0805 | R11 (con R12 fija 5,1 V) |
| 4 | 100 kΩ | 0805 | R10, R13, R14, R24 |
| 4 | 100 nF | 0805 | C3, C9, C11, C12 |
| 3 | 10 µF, ≥ 10 V | 0805 | C1, C2, C13 |
| 3 | 22 µF, ≥ 10 V | 1206 | C4, C5, C6 (C5 y C6 están en la salida de 5,1 V) |
| 1 | 220 µF, 10 V, electrolítico Ø 6,3 mm | THT, paso 2,5 mm | C7 |
| 1 | 220 µF, 6,3 V, electrolítico Ø 6,3 mm | THT, paso 2,5 mm | C8 |
| 1 | Inductor 22 µH, ≥ 1,5 A, 4 × 4 mm | SMD (tipo NR4018 / CD43) | L1 |

## Conectores e interfaz

| Cant. | Componente | Referencias | Notas |
| --- | --- | --- | --- |
| 2 | Tira hembra 1 × 22, paso 2,54 mm (altura 8,5 mm) | J1, J3 | Zócalo de la DevKitC; se puede cortar de tiras de 1 × 40 |
| 1 | USB‑C hembra de 6 pines (solo carga), SMD horizontal | J2 | Tipo GCT USB4125 |
| 3 | JST XH 2 pines vertical (macho, para placa) | J4, J9, J10 | Batería, motor e interruptor; van en la **cara inferior** |
| 1 | JST XH 3 pines vertical | J7 | SEN0564 |
| 2 | JST XH 4 pines vertical | J5, J6 | OLED y MLX90614 |
| 1 | JST XH 6 pines vertical | J8 | INMP441 |
| 3 | Pulsador táctil 6 × 6 mm, 4 patas | SW2, SW3, SW4 | Altura a elección según la carcasa |
| 1 | Buzzer **activo** 5 V, Ø 12 mm, patas a 7,6 mm | BZ1 | Activo en alto en esta placa (ver README) |

## Fuera de la placa

| Cant. | Componente | Notas |
| --- | --- | --- |
| 1 | ESP32‑S3‑DevKitC‑1 N16R8 | Ya la tienes |
| — | Módulos OLED, MLX90614, SEN0564, INMP441 y motor vibrador | Ya los tienes |
| 7 | Cables JST XH con conector (2, 2, 2, 3, 4, 4 y 6 hilos) | El otro extremo, soldado o con Dupont hembra al módulo |
| 1 | Adaptador JST‑SYP (rojo, el de tu batería) hembra → JST XH 2 pines | O cortar y soldar un XH a la batería; **respetar la polaridad** |
| 1 | Interruptor deslizante o de palanca para la carcasa | Unido a J10 con un cable XH de 2 hilos |
| 2 | Tornillos M2 + separadores | Agujeros H1 y H2 |
