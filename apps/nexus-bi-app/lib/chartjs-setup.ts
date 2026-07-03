import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip
} from "chart.js";

Chart.register(ArcElement, BarElement, CategoryScale, Legend, LinearScale, LineElement, PointElement, Title, Tooltip);

Chart.defaults.font.family = "Segoe UI, system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.color = "#6b7280";
