
import type {
  TDocumentDefinitions,
  TableCell,
  ContentStack
} from 'pdfmake/interfaces';

// ==========================================
// REPORT TEMPLATE INTERFACE
// ==========================================

export interface ReportTemplateOptions {

  schoolName: string;
  title: string;
  description: string;
  columns: string[];
  rows: string[][];
  filters: string;
  generatedDate: string;
  note: string;
  reportType: string;

}

// ==========================================
// BRAND COLORS
// Same palette as dtr-template.ts
// ==========================================

const colors = {

  blue: '#3157D5',
  purple: '#7556D9',
  orange: '#FF9638',
  green: '#087B56',
  red: '#C92A2A',
  warning: '#B36A08',
  text: '#172033',
  muted: '#64748B',
  border: '#DCE2ED',
  white: '#FFFFFF',
  background: '#F8FAFC'

};

// ==========================================
// REPORT COLUMN WIDTHS
// ==========================================

function getColumnWidths(
  reportType: string,
  columnCount: number
): (string | number)[] {

  let widths: (string | number)[];

  switch (reportType) {

    case 'master-list':
      widths = [85, '*', 65, '*', 100, 85];
      break;

    case 'assignments':
      widths = ['*', '*', '*', 85, 100];
      break;

    case 'dtr':
      widths = [85, '*', '*', 65, 65, 55, 100];
      break;

    case 'hours-summary':
      widths = ['*', '*', 75, 75, 75, 75];
      break;

    case 'weekly-compliance':
      widths = ['*', '*', 80, 80, 75, 110];
      break;

    case 'completion':
      widths = ['*', '*', 75, 75, 85, 130];
      break;

    default:
      widths = Array(columnCount).fill('*');

  }

  return widths.length === columnCount
    ? widths
    : Array(columnCount).fill('*');

}

// ==========================================
// STATUS COLORS
// ==========================================

function getStatusColor(value: string): string {

  switch (value.trim().toLowerCase()) {

    case 'verified':
    case 'approved':
    case 'active':
    case 'hours completed':
      return colors.green;

    case 'provisional':
    case 'pending verification':
      return colors.purple;

    case 'incomplete':
    case 'pending sync':
    case 'pending review':
    case 'needs follow-up':
    case 'returned for revision':
      return colors.warning;

    case 'rejected':
    case 'disabled':
      return colors.red;

    case 'ongoing':
      return colors.blue;

    case 'inactive':
    case 'unassigned':
    case 'not started':
    case 'not submitted':
    case 'not recorded':
    case 'unknown':
    case 'ended':
    case 'formal completion not recorded':
      return colors.muted;

    default:
      return colors.text;

  }

}

// ==========================================
// INFORMATION FIELD
// Same style as DTR student information
// ==========================================

function infoField(
  label: string,
  value: string
): ContentStack {

  return {

    stack: [

      {
        text: label,
        color: colors.muted,
        fontSize: 8,
        margin: [0, 0, 0, 4]
      },

      {
        text: value || 'Not available',
        color: colors.text,
        fontSize: 10,
        bold: true
      }

    ],

    margin: [5, 5, 5, 6]

  };

}

// ==========================================
// SHARED REPORT TEMPLATE
// ==========================================

export function createReportTemplate(
  options: ReportTemplateOptions
): TDocumentDefinitions {

  // ========================================
  // REPORT INFORMATION
  // ========================================

  const reportInfoBody: TableCell[][] = [

    [
      infoField(
        'Total records',
        String(options.rows.length)
      ),

      infoField(
        'Date generated',
        options.generatedDate
      )
    ],

    [
      {
        ...infoField(
          'Applied filters',
          options.filters || 'All records'
        ),
        colSpan: 2
      } as TableCell,

      {}
    ]

  ];

  // ========================================
  // REPORT TABLE HEADER
  // ========================================

  const tableBody: TableCell[][] = [

    options.columns.map(text => ({

      text,
      bold: true,
      color: colors.white,
      fontSize: 9

    }))

  ];

  // ========================================
  // REPORT TABLE ROWS
  // ========================================

  for (const row of options.rows) {

    const tableRow: TableCell[] =
      options.columns.map((header, index) => {

        const column = header.toLowerCase();

        const value = String(
          row[index] ?? '—'
        );

        const isStatus =
          column.includes('status') ||
          column === 'verification';

        const isNumeric =
          column.includes('hours') ||
          column.includes('reports') ||
          column.includes('rate') ||
          [
            'required',
            'verified',
            'provisional',
            'remaining'
          ].includes(column);

        return {

          text: value,

          color: isStatus
            ? getStatusColor(value)
            : colors.text,

          fontSize: isStatus ? 8.5 : 9,

          alignment: isNumeric
            ? 'center'
            : 'left'

        };

      });

    tableBody.push(tableRow);

  }

  // ========================================
  // EMPTY REPORT STATE
  // ========================================

  if (tableBody.length === 1) {

    const emptyRow: TableCell[] = [

      {
        text: 'No records available for the selected filters.',
        colSpan: options.columns.length,
        alignment: 'center',
        color: colors.muted,
        margin: [0, 8, 0, 8]
      }

    ];

    for (
      let index = 1;
      index < options.columns.length;
      index++
    ) {

      emptyRow.push({});

    }

    tableBody.push(emptyRow);

  }

  // ========================================
  // PDF DOCUMENT DEFINITION
  // ========================================

  return {

    pageSize: 'A4',

    pageOrientation: 'landscape',

    pageMargins: [36, 32, 36, 42],

    info: {

      title: `InternTrack - ${options.title}`,

      author: 'InternTrack',

      subject: 'Institutional Internship Records'

    },

    defaultStyle: {

      font: 'Roboto',

      fontSize: 9,

      color: colors.text

    },

    content: [

      // ====================================
      // INTERNTRACK BRANDING
      // ====================================

      {

        columns: [

          {

            stack: [

              {

                text: [

                  {
                    text: 'Intern',
                    color: colors.blue
                  },

                  {
                    text: 'Track',
                    color: colors.orange
                  }

                ],

                fontSize: 21,

                bold: true

              },

              {

                text: 'Internship Management System',

                fontSize: 8,

                color: colors.muted,

                margin: [0, 3, 0, 0]

              }

            ]

          },

          {

            stack: [

              {

                text: 'INSTITUTIONAL RECORD',

                color: colors.blue,

                bold: true,

                fontSize: 8,

                alignment: 'right'

              },

              {

                text: 'OJT Coordinator documentation',

                color: colors.muted,

                fontSize: 8,

                alignment: 'right',

                margin: [0, 4, 0, 0]

              }

            ]

          }

        ],

        margin: [0, 0, 0, 13]

      },

      // ====================================
      // BRAND ACCENT LINE
      // Adjusted for A4 landscape
      // ====================================

      {

        canvas: [

          {

            type: 'rect',

            x: 0,
            y: 0,
            w: 515,
            h: 3,

            color: colors.blue

          },

          {

            type: 'rect',

            x: 515,
            y: 0,
            w: 169,
            h: 3,

            color: colors.purple

          },

          {

            type: 'rect',

            x: 684,
            y: 0,
            w: 85,
            h: 3,

            color: colors.orange

          }

        ],

        margin: [0, 0, 0, 19]

      },

      // ====================================
      // INSTITUTIONAL HEADER
      // ====================================

      {

        text:
          options.schoolName ||
          'Pamantasan ng Lungsod ng Valenzuela',

        alignment: 'center',

        fontSize: 12,

        bold: true,

        margin: [0, 0, 0, 5]

      },

      {

        text: 'On-the-Job Training Program',

        alignment: 'center',

        fontSize: 9,

        color: colors.muted,

        margin: [0, 0, 0, 13]

      },

      {

        text: options.title,

        alignment: 'center',

        fontSize: 24,

        bold: true,

        color: colors.text,

        margin: [0, 0, 0, 5]

      },

      {

        text: options.description,

        alignment: 'center',

        fontSize: 10,

        color: colors.muted,

        margin: [0, 0, 0, 20]

      },

      // ====================================
      // REPORT INFORMATION
      // ====================================

      {

        text: 'Report information',

        fontSize: 11,

        bold: true,

        margin: [0, 0, 0, 8]

      },

      {

        table: {

          widths: ['*', '*'],

          body: reportInfoBody

        },

        layout: {

          fillColor: () => colors.background,

          hLineWidth: () => 0.5,

          vLineWidth: () => 0.5,

          hLineColor: () => colors.border,

          vLineColor: () => colors.border

        },

        margin: [0, 0, 0, 18]

      },

      // ====================================
      // REPORT DETAILS
      // ====================================

      {

        text: options.reportType === 'dtr'
          ? 'Attendance details'
          : 'Report details',

        fontSize: 11,

        bold: true,

        margin: [0, 0, 0, 8]

      },

      {

        table: {

          headerRows: 1,

          widths: getColumnWidths(
            options.reportType,
            options.columns.length
          ),

          body: tableBody,

          dontBreakRows: true

        },

        layout: {

          fillColor: (rowIndex: number) =>

            rowIndex === 0

              ? colors.blue

              : rowIndex % 2 === 0

                ? colors.background

                : colors.white,

          hLineWidth: () => 0.5,

          vLineWidth: () => 0,

          hLineColor: () => colors.border,

          paddingTop: () => 8,

          paddingBottom: () => 8,

          paddingLeft: () => 8,

          paddingRight: () => 8

        },

        margin: [0, 0, 0, 18]

      },

      // ====================================
      // REPORT POLICY NOTE
      // ====================================

      {

        text: options.note,

        fontSize: 8,

        color: colors.muted,

        lineHeight: 1.3,

        margin: [0, 0, 0, 24]

      }

    ],

    // ======================================
    // DOCUMENT FOOTER
    // ======================================

    footer: (
      currentPage: number,
      pageCount: number
    ) => ({

      stack: [

        {

          canvas: [

            {

              type: 'line',

              x1: 0,
              y1: 0,
              x2: 769,
              y2: 0,

              lineWidth: 0.5,

              lineColor: colors.border

            }

          ],

          margin: [0, 0, 0, 8]

        },

        {

          columns: [

            {

              text: 'System-generated by InternTrack',

              fontSize: 8,

              color: colors.muted

            },

            {

              text: `Page ${currentPage} of ${pageCount}`,

              alignment: 'right',

              fontSize: 8,

              color: colors.muted

            }

          ]

        }

      ],

      margin: [36, 0, 36, 0]

    })

  };

}
