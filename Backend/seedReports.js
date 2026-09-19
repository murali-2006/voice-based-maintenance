const db = require("./firebaseAdmin");

const sampleReports = [
  {
    problem: "Oil leakage",
    solution: "Hydraulic pump replaced",
    maintenance_status: "Completed",
    maintenance_time: "2:30 PM",
    report:
      "The machine had an oil leakage near the hydraulic pump. The hydraulic pump was replaced and the leakage was fixed.",
  },
  {
    problem: "Motor overheating",
    solution: "Cooling fan cleaned and replaced",
    maintenance_status: "Completed",
    maintenance_time: "10:15 AM",
    report:
      "The machine motor was overheating. The cooling fan was cleaned and replaced.",
  },
  {
    problem: "Oil leakage",
    solution: "Oil seal replaced",
    maintenance_status: "Completed",
    maintenance_time: "11:45 AM",
    report:
      "Oil leakage was observed near the pump section. The damaged oil seal was replaced.",
  },
  {
    problem: "Sensor failure",
    solution: "Proximity sensor replaced",
    maintenance_status: "Completed",
    maintenance_time: "3:20 PM",
    report:
      "The proximity sensor was not detecting the machine position correctly. The sensor was replaced.",
  },
  {
    problem: "Oil leakage",
    solution: "Pipe joint tightened and seal replaced",
    maintenance_status: "Completed",
    maintenance_time: "4:10 PM",
    report:
      "Oil leakage was found at the hydraulic pipe joint. The joint was tightened and the seal was replaced.",
  },

  {
    problem: "Hydraulic pressure low",
    solution: "Hydraulic filter replaced",
    maintenance_status: "Completed",
    maintenance_time: "9:30 AM",
    report:
      "Hydraulic pressure was lower than normal. The hydraulic filter was replaced.",
  },
  {
    problem: "Bearing noise",
    solution: "Bearing lubricated",
    maintenance_status: "Completed",
    maintenance_time: "1:10 PM",
    report:
      "Abnormal bearing noise was detected during operation. The bearing was lubricated.",
  },
  {
    problem: "Hydraulic pressure low",
    solution: "Pressure valve adjusted",
    maintenance_status: "Completed",
    maintenance_time: "2:40 PM",
    report:
      "Hydraulic pressure was low during operation. The pressure valve was adjusted.",
  },
  {
    problem: "Motor vibration",
    solution: "Motor alignment corrected",
    maintenance_status: "Completed",
    maintenance_time: "11:20 AM",
    report:
      "Excessive motor vibration was observed. Motor alignment was corrected.",
  },
  {
    problem: "Hydraulic pressure low",
    solution: "Hydraulic pump inspected",
    maintenance_status: "In Progress",
    maintenance_time: "4:25 PM",
    report:
      "Hydraulic pressure remains low. The hydraulic pump is under inspection.",
  },

  {
    problem: "Conveyor belt slipping",
    solution: "Belt tension adjusted",
    maintenance_status: "Completed",
    maintenance_time: "8:45 AM",
    report:
      "The conveyor belt was slipping during operation. Belt tension was adjusted.",
  },
  {
    problem: "Sensor failure",
    solution: "Sensor wiring repaired",
    maintenance_status: "Completed",
    maintenance_time: "12:15 PM",
    report:
      "A sensor failure was detected. Damaged sensor wiring was repaired.",
  },
  {
    problem: "Conveyor belt slipping",
    solution: "Drive roller replaced",
    maintenance_status: "Completed",
    maintenance_time: "3:35 PM",
    report:
      "The conveyor belt was slipping because of a worn drive roller. The roller was replaced.",
  },
  {
    problem: "Temperature high",
    solution: "Cooling system cleaned",
    maintenance_status: "Completed",
    maintenance_time: "10:50 AM",
    report:
      "Machine temperature was higher than normal. The cooling system was cleaned.",
  },
  {
    problem: "Conveyor belt slipping",
    solution: "Belt tension adjusted",
    maintenance_status: "Completed",
    maintenance_time: "2:05 PM",
    report:
      "The conveyor belt was slipping again. Belt tension was adjusted.",
  },

  {
    problem: "Bearing noise",
    solution: "Bearing replaced",
    maintenance_status: "Completed",
    maintenance_time: "9:15 AM",
    report:
      "Abnormal bearing noise was detected. The damaged bearing was replaced.",
  },
  {
    problem: "Electrical fault",
    solution: "Loose terminal connection repaired",
    maintenance_status: "Completed",
    maintenance_time: "1:40 PM",
    report:
      "An electrical fault was found in the control panel. A loose terminal connection was repaired.",
  },
  {
    problem: "Bearing noise",
    solution: "Bearing lubricated",
    maintenance_status: "Completed",
    maintenance_time: "11:35 AM",
    report:
      "Bearing noise was detected during startup. The bearing was lubricated.",
  },
  {
    problem: "Electrical fault",
    solution: "Damaged relay replaced",
    maintenance_status: "Completed",
    maintenance_time: "3:05 PM",
    report:
      "An electrical fault caused the machine to stop. The damaged relay was replaced.",
  },
  {
    problem: "Bearing noise",
    solution: "Bearing inspection completed",
    maintenance_status: "Completed",
    maintenance_time: "4:00 PM",
    report:
      "Bearing noise was checked during maintenance. Inspection was completed and the bearing is operational.",
  },
];

async function seedReports() {
  try {
    const machineSnapshot = await db
      .collection("machines")
      .get();

    if (machineSnapshot.empty) {
      console.log(
        "No machines found in Firestore."
      );
      return;
    }

    const machines = machineSnapshot.docs
      .map((doc) => doc.data())
      .sort(
        (a, b) =>
          Number(a.machine_id) -
          Number(b.machine_id)
      );

    console.log(
      `Found ${machines.length} machines.`
    );

    const batch = db.batch();

    sampleReports.forEach((sample, index) => {
      const machine =
        machines[index % machines.length];

      const reportRef = db
        .collection("maintenance_reports")
        .doc();

      const daysAgo =
        sampleReports.length - index;

      const createdAt = new Date(
        Date.now() -
          daysAgo * 24 * 60 * 60 * 1000
      );

      batch.set(reportRef, {
        machine_id: machine.machine_id,

        machine_code:
          machine.machine_code || "",

        machine_name:
          machine.machine_name || "",

        engineer_id: "1",

        original_text:
          sample.report,

        source_language: "en-US",

        translated_report:
          sample.report,

        report: sample.report,

        problem: sample.problem,

        solution: sample.solution,

        maintenance_status:
          sample.maintenance_status,

        maintenance_time:
          sample.maintenance_time,

        created_at: createdAt,
      });
    });

    await batch.commit();

    console.log(
      "20 sample maintenance reports added successfully."
    );
  } catch (error) {
    console.error(
      "Error adding sample reports:",
      error
    );
  }
}

seedReports();