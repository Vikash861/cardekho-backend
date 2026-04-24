import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const carsFilePath = path.join(__dirname, "data", "cars.json");
const carDataset = JSON.parse(fs.readFileSync(carsFilePath, "utf-8"));

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  })
);
app.use(express.json());

const normalizeText = (value) => String(value || "").trim().toLowerCase();

const mileageToleranceByFuelType = {
  petrol: 2.5,
  diesel: 2.5,
  cng: 3,
  electric: 40,
};

const getBudgetScore = (car, budget) => {
  if (budget < car.budgetMin) {
    return 0;
  }

  const effectivePrice = Math.min(
    Math.max(car.exShowroomPrice, car.budgetMin),
    car.budgetMax
  );
  const closenessRatio = 1 - Math.min(Math.abs(budget - effectivePrice) / budget, 1);

  let score = 10 + closenessRatio * 20;

  if (budget >= car.budgetMin && budget <= car.budgetMax) {
    score += 5;
  }

  if (budget > car.budgetMax * 1.4) {
    score -= 6;
  }

  return Math.max(8, Math.min(30, Math.round(score)));
};

const getMileageScore = (car, preferences) => {
  const baseTolerance =
    mileageToleranceByFuelType[preferences.fuelType] ||
    mileageToleranceByFuelType.petrol;
  const dynamicTolerance = Math.max(baseTolerance, preferences.mileage * 0.12);
  const mileageGap = car.mileage - preferences.mileage;

  if (mileageGap >= 0) {
    return 25;
  }

  if (Math.abs(mileageGap) <= dynamicTolerance) {
    const scoreDrop = (Math.abs(mileageGap) / dynamicTolerance) * 12;
    return Math.max(10, Math.round(25 - scoreDrop));
  }

  return 0;
};

const buildMatchHighlights = (car, preferences) => {
  const highlights = [];

  highlights.push(`${car.fuelType} matches your fuel preference`);
  highlights.push(`${preferences.transmission} transmission available`);

  if (preferences.budget >= car.budgetMax) {
    highlights.push("Fits comfortably within your budget");
  } else if (preferences.budget >= car.budgetMin) {
    highlights.push("Has variants close to your budget");
  }

  if (car.useCase.map(normalizeText).includes(preferences.useCase)) {
    highlights.push(`Suited for ${preferences.useCase} driving`);
  }

  if (car.priorities.map(normalizeText).includes(preferences.priority)) {
    highlights.push(`Strong on ${preferences.priority}`);
  }

  return highlights;
};

const evaluateCar = (car, preferences) => {
  const normalizedFuelType = normalizeText(car.fuelType);
  const transmissionOptions = car.transmission.map(normalizeText);
  const useCases = car.useCase.map(normalizeText);
  const priorities = car.priorities.map(normalizeText);
  const budgetScore = getBudgetScore(car, preferences.budget);
  const mileageScore = getMileageScore(car, preferences);

  if (normalizedFuelType !== preferences.fuelType) {
    return null;
  }

  if (!transmissionOptions.includes(preferences.transmission)) {
    return null;
  }

  if (budgetScore === 0 || mileageScore === 0) {
    return null;
  }

  let score = budgetScore + mileageScore + 20;

  if (useCases.includes(preferences.useCase)) {
    score += 15;
  } else if (preferences.useCase === "mixed") {
    score += 8;
  } else {
    score -= 10;
  }

  if (priorities.includes(preferences.priority)) {
    score += 10;
  } else {
    score -= 8;
  }

  if (preferences.useCase === "family" && car.seating >= 5) {
    score += car.seating >= 7 ? 6 : 3;
  }

  if (preferences.useCase === "city" && car.bodyType.toLowerCase().includes("hatch")) {
    score += 4;
  }

  if (preferences.useCase === "highway" && useCases.includes("highway")) {
    score += 4;
  }

  const finalScore = Math.max(1, Math.min(99, Math.round(score)));

  if (finalScore < 55) {
    return null;
  }

  return {
    ...car,
    matchScore: finalScore,
    highlights: buildMatchHighlights(car, preferences),
  };
};

app.get("/api/test", (_req, res) => {
  res.json({
    success: true,
    message: "Backend API is working",
    totalCars: carDataset.length,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/cars", (_req, res) => {
  res.json({
    success: true,
    total: carDataset.length,
    cars: carDataset,
  });
});

app.post("/api/recommendations", (req, res) => {
  const budget = Number(req.body?.budget);
  const mileage = Number(req.body?.mileage);
  const fuelType = normalizeText(req.body?.fuelType);
  const transmission = normalizeText(req.body?.transmission);
  const useCase = normalizeText(req.body?.useCase);
  const priority = normalizeText(req.body?.priority);

  if (!budget || !mileage || !fuelType || !transmission || !useCase || !priority) {
    return res.status(400).json({
      success: false,
      message: "budget, mileage, fuelType, transmission, useCase, and priority are required.",
    });
  }

  const preferences = {
    budget,
    mileage,
    fuelType,
    transmission,
    useCase,
    priority,
  };

  const recommendations = carDataset
    .map((car) => evaluateCar(car, preferences))
    .filter(Boolean)
    .sort((firstCar, secondCar) => secondCar.matchScore - firstCar.matchScore)
    .slice(0, 3);

  return res.json({
    success: true,
    totalCarsConsidered: carDataset.length,
    criteria: preferences,
    message:
      recommendations.length > 0
        ? "Recommendations generated successfully."
        : "No suitable cars found for the selected criteria.",
    recommendations,
  });
});

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});
