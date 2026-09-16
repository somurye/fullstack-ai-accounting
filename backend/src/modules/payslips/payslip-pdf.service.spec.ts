import { PayslipPdfService } from './payslip-pdf.service';
import { PayslipDto } from './payslips.mapper';

describe('PayslipPdfService', () => {
  let service: PayslipPdfService;

  beforeEach(() => {
    service = new PayslipPdfService();
  });

  it('PayslipDtoからPDFバッファを生成できる', async () => {
    const dummyPayslip: PayslipDto = {
      id: '11111111-1111-1111-1111-111111111111',
      tenant_id: '22222222-2222-2222-2222-222222222222',
      payroll_calculation_id: '33333333-3333-3333-3333-333333333333',
      employee_id: '44444444-4444-4444-4444-444444444444',
      status: 'confirmed',
      issued_at: '2026-05-25T10:00:00Z',
      created_at: '2026-05-25T09:00:00Z',
      updated_at: '2026-05-25T10:00:00Z',
      employee_name: '山田 太郎',
      employee_code: 'EMP001',
      department_name: '営業部',
      payroll_period: '2026-05',
      payment_date: '2026-06-10',
      created_by: '55555555-5555-5555-5555-555555555555',
      snapshot_data: {
        employee: {
          id: '44444444-4444-4444-4444-444444444444',
          employee_code: 'EMP001',
          name: '山田 太郎',
          department_name: '営業部',
        },
        attendance: {
          regular_hours: 160,
          overtime_hours: 15,
          late_night_hours: 0,
          holiday_hours: 0,
        },
        earnings: {
          salary_type: 'monthly',
          base_salary: 300000,
          hourly_wage: 0,
          regular_pay: 300000,
          overtime_pay: 30000,
          late_night_pay: 0,
          holiday_pay: 0,
          total_gross_pay: 360000,
        },
        deductions: {
          health_insurance_amount: 17928,
          care_insurance_amount: 0,
          pension_amount: 32940,
          employment_insurance_amount: 2160,
          income_tax_amount: 8420,
          resident_tax_amount: 18000,
          total_deductions: 79448,
        },
        net_pay: 280552,
      },
    };

    const buffer = await service.generatePdf(dummyPayslip);

    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(500);
    // PDFヘッダーの検証
    expect(buffer.toString('utf-8', 0, 5)).toBe('%PDF-');
  });
});
