// Umbrales con histéresis y reglas de aviso (port de esp32-device/test/test_alerts).
import { describe, expect, it } from 'vitest'
import { AlertController, classify, DEFAULT_SETTINGS, emptySnapshot, patternActive, PatternOutputs, ThresholdEvaluator } from '../src/index.ts'
import { FakeClock, RecordingOutputs } from './fakes.ts'

const snapshot = (coPpm: number | null, ambientC: number | null = null, objectC: number | null = null) => emptySnapshot({ coPpm, ambientC, objectC })

describe('umbrales', () => {
  it('clasifica con histéresis', () => {
    const threshold = { caution: 35, danger: 200 }
    expect(classify(36, threshold, 'normal', 5)).toBe('caution')
    expect(classify(31, threshold, 'caution', 5)).toBe('caution')
    expect(classify(30, threshold, 'caution', 5)).toBe('normal')
    expect(classify(196, threshold, 'danger', 5)).toBe('danger')
    expect(classify(195, threshold, 'danger', 5)).toBe('caution')
    expect(classify(10, threshold, 'normal', 5)).toBe('normal')
  })

  it('cambia de nivel solo después de muestras consecutivas', () => {
    const evaluator = new ThresholdEvaluator({ ...DEFAULT_SETTINGS.alerts, confirmSamples: 3 })
    expect(evaluator.update(snapshot(250)).level).toBe('normal')
    expect(evaluator.update(snapshot(250)).level).toBe('normal')
    // Una muestra sin valor no es evidencia en ningún sentido.
    expect(evaluator.update(snapshot(null)).level).toBe('normal')
    const danger = evaluator.update(snapshot(250))
    expect(danger.level).toBe('danger')
    expect(danger.detail('co')).toBe('CO 250 ppm')
    // Una lectura baja aislada no apaga la alarma.
    expect(evaluator.update(snapshot(5)).level).toBe('danger')
    expect(evaluator.update(snapshot(250)).level).toBe('danger')
    for (let i = 0; i < 2; i++) evaluator.update(snapshot(5))
    expect(evaluator.update(snapshot(5)).level).toBe('normal')
  })

  it('el grupo de calor combina ambiente y objeto', () => {
    const evaluator = new ThresholdEvaluator({ ...DEFAULT_SETTINGS.alerts, confirmSamples: 1 })
    const assessment = evaluator.update(snapshot(5, 41.0, 95.0))
    expect(assessment.level).toBe('danger')
    expect(assessment.groupLevel('heat')).toBe('danger')
    expect(assessment.groupLevel('co')).toBe('normal')
    expect(assessment.detail('heat')).toBe('Ambiente 41.0 °C, Objeto 95.0 °C')
    expect(assessment.detail('co')).toBe('')
  })
})

describe('controlador de alertas', () => {
  it('el LED sigue al enlace y al nivel', () => {
    const clock = new FakeClock()
    const outputs = new RecordingOutputs()
    const alerts = new AlertController(outputs, 60, true, true, clock.fn)
    expect(outputs.last('led')).toMatchObject({ color: 'blue', blink: false })
    alerts.onConnection(true)
    expect(outputs.last('led').color).toBe('green')
    alerts.onLevel('caution')
    expect(outputs.last('led').color).toBe('yellow')
    expect(outputs.last('buzz').on).toBe(150)
    alerts.onLevel('danger')
    expect(outputs.last('led')).toMatchObject({ color: 'red', blink: true })
    alerts.onLevel('normal')
    expect(outputs.last('led').color).toBe('green')
    // El mismo estado no se reenvía (reiniciaría el parpadeo).
    const leds = outputs.count('led')
    alerts.onConnection(true)
    expect(outputs.count('led')).toBe(leds)
  })

  it('la alarma de peligro se silencia y se reanuda', () => {
    const clock = new FakeClock()
    const outputs = new RecordingOutputs()
    const alerts = new AlertController(outputs, 60, true, true, clock.fn)
    alerts.onLevel('danger')
    expect(outputs.last('buzz').count).toBe(-1)
    expect(outputs.last('vibrate').on).toBe(1500)
    alerts.silence()
    expect(alerts.silenced()).toBe(true)
    expect(outputs.count('buzz-stop')).toBe(1)
    clock.now = 59000
    alerts.tick()
    expect(outputs.count('buzz')).toBe(1)
    clock.now = 61000
    alerts.tick()
    expect(outputs.count('buzz')).toBe(2)
    // El silencio solo aplica en peligro.
    alerts.onLevel('caution')
    alerts.silence()
    expect(alerts.silenced()).toBe(false)
  })

  it('aviso: vibración doble y LED azul intermitente', () => {
    const clock = new FakeClock()
    const outputs = new RecordingOutputs()
    const alerts = new AlertController(outputs, 60, true, true, clock.fn)
    alerts.onConnection(true)
    alerts.onNotice('critical')
    expect(outputs.last('vibrate').count).toBe(2)
    expect(outputs.last('buzz').count).toBe(3)
    expect(outputs.last('led')).toMatchObject({ color: 'blue', blink: true })
    alerts.onNoticeCleared()
    expect(outputs.last('led').color).toBe('green')
    alerts.onNotice('info')
    expect(outputs.last('buzz').count).toBe(1)
  })

  it('vibración al pulsar y enlace sin monitorear', () => {
    const clock = new FakeClock()
    const outputs = new RecordingOutputs()
    const alerts = new AlertController(outputs, 60, true, false, clock.fn)
    expect(outputs.last('led').color).toBe('green')
    alerts.onButton()
    expect(outputs.last('vibrate').on).toBe(60)
    // Sin vibración de botón mientras suena la alarma de peligro.
    alerts.onLevel('danger')
    const vibrations = outputs.count('vibrate')
    alerts.onButton()
    expect(outputs.count('vibrate')).toBe(vibrations)
  })
})

describe('patrones', () => {
  it('temporización', () => {
    const forever = { onMs: 400, offMs: 400, count: -1, started: 1000 }
    expect(patternActive(forever, 999)).toBe(false)
    expect(patternActive(forever, 1000)).toBe(true)
    expect(patternActive(forever, 1500)).toBe(false)
    expect(patternActive(forever, 1800)).toBe(true)
    const once = { onMs: 150, offMs: 0, count: 1, started: 0 }
    expect(patternActive(once, 149)).toBe(true)
    expect(patternActive(once, 150)).toBe(false)
    const twice = { onMs: 250, offMs: 200, count: 2, started: 0 }
    expect(patternActive(twice, 460)).toBe(true)
    expect(patternActive(twice, 900)).toBe(false)
  })

  it('las salidas siguen los patrones', () => {
    const clock = new FakeClock()
    const outputs = new PatternOutputs(clock.fn)
    outputs.setLed('yellow', true)
    outputs.buzz(100, 0, 1)
    let levels = outputs.levels(50)
    expect(levels.red && levels.green && !levels.blue).toBe(true)
    expect(levels.buzzer).toBe(true)
    expect(levels.motor).toBe(false)
    levels = outputs.levels(600)
    expect(levels.red || levels.green).toBe(false)
    expect(levels.buzzer).toBe(false)
    outputs.vibrate(1500, 3500, -1)
    expect(outputs.levels(10).motor).toBe(true)
    outputs.stopMotor()
    expect(outputs.levels(10).motor).toBe(false)
  })
})
